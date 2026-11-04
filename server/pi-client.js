// Cliente mínimo para OSIsoft / AVEVA PI Web API (sin dependencias externas).
//
// Endpoints usados:
//   GET points?path=\\SERVIDOR\TAG            -> WebId de un PI Point
//   GET attributes?path=\\AF\BD\Elem|Atrib     -> WebId de un atributo AF
//   GET streamsets/value?webId=..&webId=..     -> valor actual de varios tags en 1 llamada
//   GET streams/{webId}/interpolated           -> tendencia histórica

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';

const BATCH_SIZE = 40; // webIds por llamada (evita URLs demasiado largas)
const RESOLVE_RETRY_MS = 60_000;

export class PiClient {
  constructor({ baseUrl, user, password, caFile, rejectUnauthorized = true, timeoutMs = 10_000 }) {
    if (!baseUrl) throw new Error('PI_WEBAPI_URL no está definido');
    this.base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const isHttps = this.base.protocol === 'https:';
    this.transport = isHttps ? https : http;
    this.agent = new this.transport.Agent({
      keepAlive: true,
      maxSockets: 8,
      ...(isHttps ? { rejectUnauthorized, ca: caFile ? fs.readFileSync(caFile) : undefined } : {}),
    });
    this.auth = user ? `Basic ${Buffer.from(`${user}:${password ?? ''}`).toString('base64')}` : null;
    this.timeoutMs = timeoutMs;
    this.webIds = new Map(); // tagId -> webId
    this.byWebId = new Map(); // webId -> tagId
    this.resolveErrors = new Map(); // tagId -> mensaje
    this.lastResolve = 0;
  }

  get name() {
    return 'pi';
  }

  request(relPath, params) {
    const url = new URL(relPath, this.base);
    if (params) url.search = params.toString();
    const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (this.auth) headers.Authorization = this.auth;

    return new Promise((resolve, reject) => {
      const req = this.transport.request(url, { method: 'GET', headers, agent: this.agent }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const err = new Error(`PI Web API ${res.statusCode} en ${url.pathname}: ${body.slice(0, 200)}`);
            err.status = res.statusCode;
            return reject(err);
          }
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            reject(new Error(`Respuesta no JSON desde ${url.pathname}`));
          }
        });
      });
      req.setTimeout(this.timeoutMs, () => req.destroy(new Error(`Timeout (${this.timeoutMs} ms) en ${url.pathname}`)));
      req.on('error', reject);
      req.end();
    });
  }

  async resolveWebId(tag) {
    // Un path con "|" es un atributo AF; si no, es un PI Point.
    const endpoint = tag.path.includes('|') ? 'attributes' : 'points';
    const json = await this.request(endpoint, new URLSearchParams({ path: tag.path, selectedFields: 'WebId' }));
    if (!json.WebId) throw new Error('WebId no encontrado');
    return json.WebId;
  }

  async resolveMissing(tags) {
    const missing = tags.filter((t) => !this.webIds.has(t.id));
    if (!missing.length || Date.now() - this.lastResolve < RESOLVE_RETRY_MS) return;
    this.lastResolve = Date.now();
    const results = await Promise.allSettled(missing.map((t) => this.resolveWebId(t)));
    results.forEach((r, i) => {
      const tag = missing[i];
      if (r.status === 'fulfilled') {
        this.webIds.set(tag.id, r.value);
        this.byWebId.set(r.value, tag.id);
        this.resolveErrors.delete(tag.id);
      } else {
        this.resolveErrors.set(tag.id, `Tag no encontrado: ${r.reason.message}`);
        console.warn(`[pi] No se pudo resolver ${tag.path}: ${r.reason.message}`);
      }
    });
  }

  /** Devuelve Map<tagId, {v, t, good, digital, error?}> */
  async current(tags) {
    await this.resolveMissing(tags);
    const out = new Map();
    for (const [id, msg] of this.resolveErrors) out.set(id, { v: null, t: null, good: false, error: msg });

    const ids = tags.map((t) => this.webIds.get(t.id)).filter(Boolean);
    if (!ids.length && this.resolveErrors.size) {
      throw new Error('Ningún tag pudo resolverse en PI Web API');
    }
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const params = new URLSearchParams();
      ids.slice(i, i + BATCH_SIZE).forEach((w) => params.append('webId', w));
      params.set('selectedFields', 'Items.WebId;Items.Value.Timestamp;Items.Value.Value;Items.Value.Good;Items.Value.Questionable;Items.Value.Substituted');
      const json = await this.request('streamsets/value', params);
      for (const item of json.Items ?? []) {
        const tagId = this.byWebId.get(item.WebId);
        if (!tagId) continue;
        out.set(tagId, item.Value ? normalize(item.Value) : { v: null, t: null, good: false, error: 'Sin valor' });
      }
    }
    return out;
  }

  /** Tendencia interpolada: [{t: epochMs, v}] */
  async history(tag, range) {
    await this.resolveMissing([tag]);
    const webId = this.webIds.get(tag.id);
    if (!webId) throw new Error(this.resolveErrors.get(tag.id) ?? 'Tag no resuelto');
    const params = new URLSearchParams({
      startTime: range.start,
      endTime: '*',
      interval: range.interval,
      selectedFields: 'Items.Timestamp;Items.Value;Items.Good',
    });
    const json = await this.request(`streams/${encodeURIComponent(webId)}/interpolated`, params);
    return (json.Items ?? [])
      .filter((it) => it.Good !== false)
      .map((it) => ({ t: Date.parse(it.Timestamp), v: normalize(it).v }))
      .filter((p) => p.v !== null && p.v !== undefined);
  }
}

// Los estados digitales (y los "System States" como "I/O Timeout") llegan como objeto {Name, Value}.
function normalize(val) {
  let v = val.Value;
  let digital = false;
  if (v !== null && typeof v === 'object') {
    digital = true;
    v = v.Name ?? String(v.Value);
  }
  return {
    v,
    t: val.Timestamp ?? null,
    good: val.Good !== false,
    questionable: Boolean(val.Questionable),
    substituted: Boolean(val.Substituted),
    digital,
  };
}
