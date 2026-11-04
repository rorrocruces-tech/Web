// Fuente de datos vía PI SDK (el que instala PI ProcessBook), sin PI Web API.
// Lanza server/pisdk-bridge.ps1 como proceso hijo y conversa con él por stdin/stdout (JSON por línea).
// Sólo funciona en Windows, en un equipo con PI SDK instalado y acceso al servidor PI.

import { spawn } from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pisdk-bridge.ps1');

// ProcessBook 3.x es de 32 bits, por lo que su PI SDK está registrado para 32 bits:
// por defecto se usa la PowerShell de 32 bits (SysWOW64).
function defaultPowerShell() {
  const win = process.env.WINDIR || 'C:\\Windows';
  const ps32 = path.join(win, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(ps32) ? ps32 : 'powershell.exe';
}

export class PiSdkClient {
  constructor({ powershell, timeoutMs = 20_000 } = {}) {
    this.powershell = powershell || defaultPowerShell();
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.lastError = null;
  }

  get name() {
    return 'pisdk';
  }

  start() {
    const child = spawn(
      this.powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    child.stderr.on('data', (d) => console.error(`[pisdk] ${d.toString().trim()}`));
    child.on('error', (err) => this.onExit(`No se pudo iniciar PowerShell (${this.powershell}): ${err.message}`));
    child.on('exit', (code) => this.onExit(this.lastError ?? `El puente PI SDK terminó (código ${code})`));
  }

  onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      return console.warn(`[pisdk] línea no JSON: ${line}`);
    }
    if ('ready' in msg) {
      if (msg.ready) console.log(`[pisdk] PI SDK ${msg.sdk} listo (PowerShell ${msg.bits} bits)`);
      else this.lastError = msg.error;
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg);
    else p.reject(new Error(msg.error ?? 'Error en PI SDK'));
  }

  onExit(reason) {
    if (!this.child) return;
    this.child = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  call(op, payload) {
    if (!this.child) this.start(); // arranca (o re-arranca tras una caída) bajo demanda
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout (${this.timeoutMs} ms) esperando a PI SDK`));
        this.child?.kill(); // el puente quedó colgado: se reinicia en la próxima llamada
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`);
    });
  }

  /** Devuelve Map<tagId, {v, t, good, digital, error?}> */
  async current(tags) {
    const res = await this.call('current', { paths: tags.map((t) => t.path) });
    const items = [].concat(res.items ?? []);
    const out = new Map();
    tags.forEach((tag, i) => {
      const it = items[i] ?? {};
      out.set(
        tag.id,
        it.error
          ? { v: null, t: null, good: false, error: `Tag no encontrado o sin acceso: ${it.error}` }
          : { v: it.v, t: new Date(it.t).toISOString(), good: it.good !== false, digital: Boolean(it.digital) },
      );
    });
    if (tags.length && [...out.values()].every((v) => v.error)) {
      throw new Error(`Ningún tag pudo leerse con PI SDK (${items[0]?.error ?? 'sin respuesta'})`);
    }
    return out;
  }

  /** Tendencia interpolada: [{t: epochMs, v}] */
  async history(tag, range) {
    const res = await this.call('history', {
      path: tag.path,
      start: range.start,
      interval: range.interval,
      count: Math.round(range.ms / range.stepMs) + 1,
    });
    return [].concat(res.points ?? []);
  }
}
