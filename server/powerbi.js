// Exportación para Power BI: dos tablas CSV listas para Power Query.
//
//   GET /api/powerbi/tags.csv                          -> dimensión de tags (nombre, área, unidad, límites, KPI)
//   GET /api/powerbi/valores.csv?dias=30&intervalo=15m -> valores interpolados de todos los tags (formato largo)
//
// Los valores se piden a la misma fuente que usa el tablero (PI SDK, PI Web API o simulador).
// Las fechas se entregan en hora local del servidor, sin zona horaria, para que Power BI
// (Desktop o servicio con gateway) muestre siempre la misma hora que ProcessBook.

import { evaluate } from './alarms.js';

const INTERVALS = { '1m': 60, '5m': 300, '10m': 600, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400 };
const MAX_POINTS_PER_TAG = 100_000;
const CACHE_TTL_MS = 10 * 60_000;

export function createPowerBiHandler({ config, tags, source, sendJson }) {
  const cache = new Map(); // clave -> { at, promise }
  const groupOrder = new Map(config.groups.map((g, i) => [g.id, { name: g.name, order: i + 1 }]));

  function tagsCsv() {
    const header = ['TagId', 'Nombre', 'Area', 'OrdenArea', 'Tipo', 'Kpi', 'Unidad', 'Ruta', 'Min', 'Max', 'LL', 'L', 'H', 'HH'];
    const rows = tags.map((t) => {
      const g = groupOrder.get(t.group);
      const l = t.limits ?? {};
      return [t.id, t.name, g.name, g.order, t.type, t.kpi ?? '', t.unit ?? '', t.path, t.min, t.max, l.ll, l.l, l.h, l.hh];
    });
    return toCsv(header, rows);
  }

  async function valoresCsv(dias, intervalo) {
    const stepSec = INTERVALS[intervalo];
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const startMs = midnight.getTime() - dias * 86_400_000;
    // "t-30d" = hoy a las 00:00 menos 30 días: la grilla queda alineada (00:00, 00:15, ...)
    const range = { start: `t-${dias}d`, interval: intervalo, ms: now - startMs, stepMs: stepSec * 1000, startMs };
    const horas = stepSec / 3600;

    const header = ['FechaHora', 'TagId', 'Valor', 'Texto', 'Alarma', 'Marcha', 'IntervaloHoras'];
    const rows = [];
    const errors = [];
    for (const tag of tags) {
      let points;
      try {
        points = await source.history(tag, range);
      } catch (err) {
        errors.push(`${tag.id}: ${err.message}`);
        continue;
      }
      for (const p of points) {
        const numeric = typeof p.v === 'number' && Number.isFinite(p.v);
        const alarm = evaluate(tag, { v: p.v, t: null, good: true }, now.getTime(), Infinity).alarm;
        const marcha = tag.type === 'digital' ? (tag.onStates?.includes(String(p.v)) ? 1 : 0) : '';
        rows.push([
          localIso(p.t),
          tag.id,
          numeric ? +p.v.toFixed(6) : '',
          numeric ? '' : String(p.v),
          alarm ?? '',
          marcha,
          horas,
        ]);
      }
    }
    if (errors.length) console.warn(`[powerbi] ${errors.length} tag(s) sin histórico:\n  ${errors.join('\n  ')}`);
    if (errors.length === tags.length) throw new Error(`No se pudo leer ningún tag: ${errors[0]}`);
    return toCsv(header, rows);
  }

  return async function handle(url, res) {
    try {
      if (url.pathname.endsWith('/tags.csv')) return sendCsv(res, tagsCsv());

      const dias = Number(url.searchParams.get('dias') ?? 30);
      const intervalo = url.searchParams.get('intervalo') ?? '15m';
      if (!Number.isInteger(dias) || dias < 1 || dias > 400) return sendJson(res, 400, { error: 'dias debe ser un entero entre 1 y 400' });
      if (!INTERVALS[intervalo]) return sendJson(res, 400, { error: `intervalo debe ser uno de: ${Object.keys(INTERVALS).join(', ')}` });
      if (((dias + 1) * 86_400) / INTERVALS[intervalo] > MAX_POINTS_PER_TAG) {
        return sendJson(res, 400, { error: `Demasiados puntos por tag: use un intervalo mayor o menos días` });
      }

      const key = `${dias}|${intervalo}`;
      let entry = cache.get(key);
      if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
        entry = { at: Date.now(), promise: valoresCsv(dias, intervalo) };
        cache.set(key, entry);
        entry.promise.catch(() => cache.delete(key)); // no guardar errores en caché
      }
      const t0 = Date.now();
      const csv = await entry.promise;
      console.log(`[powerbi] valores.csv dias=${dias} intervalo=${intervalo} (${Math.round(csv.length / 1024)} KB, ${Date.now() - t0} ms)`);
      sendCsv(res, csv);
    } catch (err) {
      console.error(`[powerbi] ${err.message}`);
      sendJson(res, 502, { error: err.message });
    }
  };
}

function sendCsv(res, csv) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(csv);
}

function toCsv(header, rows) {
  const cell = (v) => {
    if (v === undefined || v === null) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// 2026-11-04T14:15:00 en hora local del servidor (sin zona)
function localIso(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
