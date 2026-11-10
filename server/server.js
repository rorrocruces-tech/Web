// Servidor del tablero: consulta PI Web API en un único ciclo de polling y
// reparte los valores a todos los navegadores mediante Server-Sent Events (SSE).
// Así PI recibe la misma carga con 1 o con 100 usuarios conectados, y las
// credenciales de PI nunca llegan al navegador.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PiClient } from './pi-client.js';
import { PiSdkClient } from './pisdk-client.js';
import { Simulator } from './simulator.js';
import { evaluate } from './alarms.js';
import { notify, smsEnabled } from './notifier.js';
import { createPowerBiHandler } from './powerbi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const POLL_MS = Math.max(1000, Number(process.env.POLL_MS || 5000));
const RECENT_WINDOW_MS = 30 * 60_000;
const CONFIG_FILE = process.env.TAGS_FILE || path.join(ROOT, 'config', 'tags.json');

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const tags = config.groups.flatMap((g) => g.tags.map((t) => ({ ...t, group: g.id })));
const tagById = new Map(tags.map((t) => [t.id, t]));
if (tagById.size !== tags.length) throw new Error(`IDs de tag duplicados en ${CONFIG_FILE}`);

// Fuente de datos: PI_SOURCE = webapi | pisdk | sim
//   webapi -> PI Web API (HTTPS)
//   pisdk  -> PI SDK instalado con PI ProcessBook (sólo Windows, sin PI Web API)
//   sim    -> valores simulados
const SOURCE_KIND = (
  process.env.SIMULATE === 'true' ? 'sim' : process.env.PI_SOURCE || (process.env.PI_WEBAPI_URL ? 'webapi' : 'sim')
).toLowerCase();

function createSource(kind) {
  switch (kind) {
    case 'sim':
      return new Simulator();
    case 'pisdk':
      return new PiSdkClient({
        powershell: process.env.PISDK_POWERSHELL,
        timeoutMs: Number(process.env.PI_TIMEOUT_MS || 20_000),
      });
    case 'webapi':
      return new PiClient({
        baseUrl: process.env.PI_WEBAPI_URL,
        user: process.env.PI_USER,
        password: process.env.PI_PASSWORD,
        caFile: process.env.PI_CA_FILE,
        rejectUnauthorized: process.env.PI_REJECT_UNAUTHORIZED !== 'false',
        timeoutMs: Number(process.env.PI_TIMEOUT_MS || 10_000),
      });
    default:
      throw new Error(`PI_SOURCE desconocido: "${kind}" (use webapi, pisdk o sim)`);
  }
}
const source = createSource(SOURCE_KIND);
const SOURCE_LABEL = { sim: 'SIMULADOR', pisdk: 'PI SDK (ProcessBook)', webapi: process.env.PI_WEBAPI_URL }[SOURCE_KIND];

const RANGES = {
  '1h': { start: '*-1h', interval: '1m', ms: 3_600_000, stepMs: 60_000 },
  '8h': { start: '*-8h', interval: '5m', ms: 8 * 3_600_000, stepMs: 300_000 },
  '24h': { start: '*-24h', interval: '10m', ms: 24 * 3_600_000, stepMs: 600_000 },
  '7d': { start: '*-7d', interval: '1h', ms: 7 * 86_400_000, stepMs: 3_600_000 },
  '30d': { start: '*-30d', interval: '6h', ms: 30 * 86_400_000, stepMs: 6 * 3_600_000 },
};

// ---------------------------------------------------------------- estado ---
const state = { source: source.name, ok: false, error: null, ts: null, values: {} };
const recent = new Map(tags.map((t) => [t.id, []])); // buffer para sparklines
const clients = new Set();
const historyCache = new Map();

async function poll() {
  const started = Date.now();
  try {
    const raw = await source.current(tags);
    const now = Date.now();
    const values = {};
    for (const tag of tags) {
      const r = raw.get(tag.id) ?? { v: null, t: null, good: false, error: 'Sin datos' };
      const val = evaluate(tag, r, now, config.staleSeconds ?? 300);
      values[tag.id] = val;
      if (val.good && typeof val.v === 'number') {
        const buf = recent.get(tag.id);
        buf.push([now, val.v]);
        while (buf.length && buf[0][0] < now - RECENT_WINDOW_MS) buf.shift();
      }
    }
    Object.assign(state, { ok: true, error: null, ts: new Date(now).toISOString(), values });
    notify(tags, values).catch((err) => console.error(`[sms] ${err.message}`));
  } catch (err) {
    state.ok = false;
    state.error = err.message;
    console.error(`[poll] ${err.message}`);
  }
  broadcast({ type: 'snapshot', ...state });
  setTimeout(poll, Math.max(250, POLL_MS - (Date.now() - started)));
}

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}

// ---------------------------------------------------------------- rutas ---
function publicConfig() {
  return {
    title: config.title,
    subtitle: config.subtitle,
    pollMs: POLL_MS,
    source: source.name,
    ranges: Object.keys(RANGES),
    groups: config.groups.map((g) => ({
      id: g.id,
      name: g.name,
      tags: g.tags.map(({ sim, ...t }) => t),
    })),
  };
}

async function handleHistory(url, res) {
  const tag = tagById.get(url.searchParams.get('id'));
  const rangeKey = url.searchParams.get('range') || '8h';
  const range = RANGES[rangeKey];
  if (!tag) return sendJson(res, 404, { error: 'Tag desconocido' });
  if (!range) return sendJson(res, 400, { error: 'Rango inválido' });

  const key = `${tag.id}|${rangeKey}`;
  const cached = historyCache.get(key);
  if (cached && Date.now() - cached.at < 30_000) return sendJson(res, 200, cached.body);
  try {
    const points = await source.history(tag, range);
    const body = { id: tag.id, range: rangeKey, points };
    historyCache.set(key, { at: Date.now(), body });
    sendJson(res, 200, body);
  } catch (err) {
    console.error(`[history] ${tag.id}: ${err.message}`);
    sendJson(res, 502, { error: err.message });
  }
}

function handleStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  if (state.ts || state.error) res.write(`data: ${JSON.stringify({ type: 'snapshot', ...state })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(url, res) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = path.resolve(PUBLIC_DIR, `.${rel}`);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { error: 'Prohibido' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'No encontrado' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método no permitido' });
  switch (url.pathname) {
    case '/api/config':
      return sendJson(res, 200, publicConfig());
    case '/api/snapshot':
      return sendJson(res, 200, { ...state, recent: Object.fromEntries(recent) });
    case '/api/stream':
      return handleStream(req, res);
    case '/api/history':
      return handleHistory(url, res);
    case '/api/powerbi/tags.csv':
    case '/api/powerbi/valores.csv':
      return powerBi(url, res);
    case '/api/health':
      return sendJson(res, state.ok ? 200 : 503, {
        ok: state.ok, source: state.source, lastUpdate: state.ts, error: state.error, clients: clients.size,
      });
    default:
      return serveStatic(url, res);
  }
});

const powerBi = createPowerBiHandler({ config, tags, source, sendJson });

// Comentario SSE periódico para que proxies/firewalls no corten la conexión.
setInterval(() => clients.forEach((res) => res.write(': ping\n\n')), 15_000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Tablero en http://${HOST}:${PORT}  ·  fuente: ${SOURCE_LABEL}  ·  ${tags.length} tags  ·  polling ${POLL_MS} ms`);
  console.log(`Avisos SMS: ${smsEnabled() ? 'ACTIVOS' : 'apagados (defina SMS_ENABLED=true y datos de httpSMS)'}`);
  poll();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    clients.forEach((res) => res.end());
    server.close(() => process.exit(0));
  });
}

// Lector mínimo de .env (KEY=VALUE), sin dependencias. No sobreescribe variables ya definidas.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
