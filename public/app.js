// Tablero en línea del sistema de agua potable.
// Recibe valores por Server-Sent Events desde /api/stream y dibuja tendencias en SVG
// (sin librerías externas: funciona en redes industriales sin acceso a internet).

const $ = (s, el = document) => el.querySelector(s);
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCALE = 'es-CL';
const SPARK_MAX = 360;
const SEVERITY = { HH: 3, LL: 3, DIG: 3, H: 2, L: 2 };
const RANGE_LABEL = { '1h': '1 h', '8h': '8 h', '24h': '24 h', '7d': '7 días', '30d': '30 días' };

const app = {
  config: null,
  tags: new Map(),
  cards: new Map(),
  buffers: new Map(),
  values: {},
  lastTs: null,
  lastMsgAt: 0,
  sourceOk: true,
  detail: { tag: null, range: '8h', points: [] },
};

init().catch((err) => showBanner(`No se pudo cargar la configuración: ${err.message}`));

async function init() {
  app.config = await getJSON('/api/config');
  const { config } = app;
  document.title = `${config.title} · Tiempo real`;
  $('#title').textContent = config.title;
  $('#subtitle').textContent = config.subtitle ?? '';
  if (config.source === 'sim') {
    const src = $('#source');
    src.hidden = false;
    src.className = 'pill pill-sim';
    src.textContent = 'Modo simulación';
    src.title = 'PI_WEBAPI_URL no configurado: los valores son simulados';
  }

  for (const g of config.groups) for (const t of g.tags) app.tags.set(t.id, { ...t, group: g.id, groupName: g.name });
  renderFilters();
  renderGroups();
  setupDetail();

  const snap = await getJSON('/api/snapshot');
  for (const [id, pts] of Object.entries(snap.recent ?? {})) app.buffers.set(id, pts.slice(-SPARK_MAX));
  if (snap.ts || snap.error) applySnapshot(snap, false);
  connect();

  setInterval(tick, 1000);
  tick();
}

// --------------------------------------------------------------- datos ---
function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => setConn('ok');
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'snapshot') applySnapshot(msg, true);
  };
  es.onerror = () => setConn(es.readyState === EventSource.CLOSED ? 'down' : 'retry');
}

function applySnapshot(msg, pushToBuffer) {
  app.lastMsgAt = Date.now();
  app.sourceOk = msg.ok;
  if (!msg.ok) {
    showBanner(`Sin comunicación con PI: ${msg.error ?? 'error desconocido'}. Se muestran los últimos valores recibidos.`);
    return;
  }
  hideBanner();
  app.lastTs = msg.ts;
  app.values = msg.values;
  const now = Date.parse(msg.ts);
  for (const [id, val] of Object.entries(msg.values)) {
    if (pushToBuffer && val.good && typeof val.v === 'number') {
      const buf = app.buffers.get(id) ?? [];
      buf.push([now, val.v]);
      if (buf.length > SPARK_MAX) buf.shift();
      app.buffers.set(id, buf);
    }
    updateCard(id, val);
  }
  renderAlarms();
}

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

// ----------------------------------------------------------- render UI ---
function renderFilters() {
  const nav = $('#filters');
  const items = [{ id: 'all', name: 'Todas las áreas' }, ...app.config.groups];
  let current = 'all';
  try { current = localStorage.getItem('ap.filter') ?? 'all'; } catch {}
  if (!items.some((i) => i.id === current)) current = 'all';

  for (const it of items) {
    const b = el('button', { type: 'button', 'data-id': it.id, 'aria-pressed': String(it.id === current) }, it.name);
    b.addEventListener('click', () => {
      nav.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      applyFilter(it.id);
      try { localStorage.setItem('ap.filter', it.id); } catch {}
    });
    nav.append(b);
  }
  queueMicrotask(() => applyFilter(current));
}

function applyFilter(id) {
  document.querySelectorAll('.group').forEach((s) => { s.hidden = id !== 'all' && s.dataset.group !== id; });
}

function renderGroups() {
  const main = $('#groups');
  for (const g of app.config.groups) {
    const section = el('section', { class: 'group', 'data-group': g.id });
    section.append(el('h2', {}, g.name, el('span', { class: 'count', hidden: '' })));
    const grid = el('div', { class: 'grid' });
    for (const t of g.tags) grid.append(buildCard(app.tags.get(t.id)));
    section.append(grid);
    main.append(section);
  }
}

function buildCard(tag) {
  const card = el('div', { class: `card card-${tag.type}`, role: 'button', tabindex: '0', 'data-id': tag.id });
  card.setAttribute('aria-label', `${tag.name}: abrir tendencia`);
  const head = el('div', { class: 'card-head' }, el('span', { class: 'card-name' }, tag.name), el('span', { class: 'slot-badge' }));
  const valueEl = el('div', { class: 'card-value' }, el('span', { class: 'v' }, '—'), el('span', { class: 'u' }, tag.unit ?? ''));
  const foot = el('div', { class: 'card-foot' }, el('span', { class: 'ts' }, '—'), el('span', { class: 'lim' }, limitsText(tag)));
  card.append(head);

  if (tag.type === 'digital') {
    card.append(el('div', { class: 'state' }, el('i'), el('span', { class: 'sv' }, '—')));
  } else if (tag.type === 'level') {
    const tank = el('div', { class: 'tank' }, el('div', { class: 'water', style: 'height:0%' }));
    for (const [k, v] of Object.entries(tag.limits ?? {})) {
      tank.append(el('div', { class: `tmark mark-${k.toUpperCase()}`, style: `bottom:${pct(tag, v)}%` }));
    }
    const info = el('div', { class: 'tank-info' }, valueEl, el('span', { class: 'pct' }, '—'), sparkSvg());
    card.append(el('div', { class: 'tank-body' }, tank, info));
  } else {
    card.append(valueEl);
    if (tag.min != null && tag.max != null) {
      const range = el('div', { class: 'range' }, el('div', { class: 'fill', style: 'width:0%' }));
      for (const [k, v] of Object.entries(tag.limits ?? {})) {
        range.append(el('div', { class: `mark mark-${k.toUpperCase()}`, style: `left:calc(${pct(tag, v)}% - 1px)`, title: `${k.toUpperCase()}: ${fmt(tag, v)}` }));
      }
      card.append(range);
    }
    card.append(sparkSvg());
  }
  card.append(foot);

  const open = () => openDetail(tag.id);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  app.cards.set(tag.id, card);
  return card;
}

function sparkSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 100 30');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path/><polyline/>';
  return svg;
}

function updateCard(id, val) {
  const card = app.cards.get(id);
  const tag = app.tags.get(id);
  if (!card || !tag) return;

  const quality = !val.good ? 'bad' : val.stale ? 'stale' : 'good';
  card.dataset.quality = quality;
  if (val.alarm) card.dataset.alarm = val.alarm; else delete card.dataset.alarm;
  $('.slot-badge', card).innerHTML = val.alarm ? `<span class="badge badge-${val.alarm}">${val.alarm === 'DIG' ? 'FALLA' : val.alarm}</span>` : '';
  $('.ts', card).textContent = val.t ? fmtTime(Date.parse(val.t)) : '—';
  card.title = val.error ?? (val.questionable ? 'Valor cuestionable' : val.substituted ? 'Valor sustituido' : '');

  if (tag.type === 'digital') {
    const on = tag.onStates?.includes(String(val.v)) ?? false;
    $('.state', card).dataset.on = String(on && quality !== 'bad');
    $('.sv', card).textContent = val.v ?? '—';
    return;
  }

  const numeric = val.good && typeof val.v === 'number';
  $('.v', card).textContent = numeric ? fmt(tag, val.v) : (typeof val.v === 'string' ? val.v : 'Sin datos');
  $('.u', card).hidden = !numeric;
  const p = numeric ? pct(tag, val.v) : 0;
  const fill = $('.fill', card);
  if (fill) fill.style.width = `${p}%`;
  const water = $('.water', card);
  if (water) {
    water.style.height = `${p}%`;
    $('.pct', card).textContent = numeric ? `${Math.round(p)} % de capacidad` : '—';
  }
  drawSpark($('.spark', card), app.buffers.get(id) ?? []);
}

function drawSpark(svg, pts) {
  if (!svg) return;
  const [path, line] = svg.children;
  if (pts.length < 2) { line.setAttribute('points', ''); path.setAttribute('d', ''); return; }
  const t0 = pts[0][0], t1 = pts.at(-1)[0];
  let lo = Infinity, hi = -Infinity;
  for (const [, v] of pts) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const coords = pts.map(([t, v]) => `${(((t - t0) / (t1 - t0 || 1)) * 100).toFixed(2)},${(28 - ((v - lo) / (hi - lo)) * 26).toFixed(2)}`);
  line.setAttribute('points', coords.join(' '));
  path.setAttribute('d', `M0,30 L${coords.join(' L')} L100,30 Z`);
}

function renderAlarms() {
  const active = [...app.tags.values()]
    .map((t) => ({ tag: t, val: app.values[t.id] }))
    .filter((x) => x.val?.alarm)
    .sort((a, b) => SEVERITY[b.val.alarm] - SEVERITY[a.val.alarm]);

  $('#alarms').hidden = active.length === 0;
  $('#alarm-count').textContent = active.length;
  const list = $('#alarm-list');
  list.replaceChildren(
    ...active.map(({ tag, val }) => {
      const b = el('button', { type: 'button' },
        el('span', { class: `badge badge-${val.alarm}` }, val.alarm === 'DIG' ? 'FALLA' : val.alarm),
        el('span', {}, `${tag.groupName} · ${tag.name}`),
        el('b', {}, typeof val.v === 'number' ? `${fmt(tag, val.v)} ${tag.unit ?? ''}` : String(val.v)));
      b.addEventListener('click', () => openDetail(tag.id));
      return el('li', {}, b);
    }),
  );

  // contador de alarmas por grupo
  document.querySelectorAll('.group').forEach((s) => {
    const n = active.filter((a) => a.tag.group === s.dataset.group).length;
    const c = $('h2 .count', s);
    c.hidden = n === 0;
    c.textContent = n;
  });
}

function tick() {
  $('#clock').textContent = new Date().toLocaleString(LOCALE);
  if (!app.lastTs) return;
  const age = Math.round((Date.now() - Date.parse(app.lastTs)) / 1000);
  $('#updated').textContent = `Actualizado ${fmtTime(Date.parse(app.lastTs))} (hace ${age}s)`;
  // si no llegan mensajes en 3 ciclos, marcamos los datos como no confiables
  const silent = Date.now() - app.lastMsgAt > app.config.pollMs * 3 + 2000;
  if (silent) setConn('retry');
  else if (!app.sourceOk) setConn('pi-down');
}

function setConn(kind) {
  const c = $('#conn');
  const map = {
    ok: ['pill pill-ok', 'En línea'],
    retry: ['pill pill-warn', 'Reconectando…'],
    down: ['pill pill-crit', 'Desconectado'],
    'pi-down': ['pill pill-crit', 'Sin datos de PI'],
  };
  const [cls, txt] = map[kind] ?? map.retry;
  if (kind === 'ok' && !app.sourceOk) return setConn('pi-down');
  c.className = cls;
  c.innerHTML = `<i></i>${txt}`;
}

function showBanner(msg) { const b = $('#banner'); b.textContent = msg; b.hidden = false; }
function hideBanner() { $('#banner').hidden = true; }

// ------------------------------------------------------ detalle / histórico ---
function setupDetail() {
  const box = $('#d-ranges');
  try { app.detail.range = localStorage.getItem('ap.range') ?? '8h'; } catch {}
  if (!app.config.ranges.includes(app.detail.range)) app.detail.range = '8h';
  for (const r of app.config.ranges) {
    const b = el('button', { type: 'button', 'data-r': r, 'aria-pressed': String(r === app.detail.range) }, RANGE_LABEL[r] ?? r);
    b.addEventListener('click', () => {
      app.detail.range = r;
      try { localStorage.setItem('ap.range', r); } catch {}
      box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      loadHistory();
    });
    box.append(b);
  }
  $('#d-csv').addEventListener('click', downloadCsv);
  const svg = $('#d-chart');
  svg.addEventListener('pointermove', onChartHover);
  svg.addEventListener('pointerleave', () => { $('#d-tip').hidden = true; svg.querySelector('.cursor')?.setAttribute('visibility', 'hidden'); });
  window.addEventListener('resize', () => { if ($('#detail').open) drawChart(); });
}

function openDetail(id) {
  const tag = app.tags.get(id);
  app.detail.tag = tag;
  $('#d-name').textContent = `${tag.groupName} · ${tag.name}`;
  $('#d-path').textContent = tag.path ?? '';
  $('#d-note').textContent = [tag.note, limitsText(tag, true)].filter(Boolean).join(' · ');
  $('#detail').showModal();
  loadHistory();
}

async function loadHistory() {
  const { tag, range } = app.detail;
  const svg = $('#d-chart');
  svg.innerHTML = '';
  $('#d-stats').innerHTML = '';
  app.detail.points = [];
  try {
    const res = await getJSON(`/api/history?id=${encodeURIComponent(tag.id)}&range=${range}`);
    if (app.detail.tag !== tag || app.detail.range !== range) return; // respuesta obsoleta
    app.detail.points = res.points;
    renderStats();
    drawChart();
  } catch (err) {
    svg.innerHTML = `<text class="empty" x="50%" y="50%" text-anchor="middle">Error al leer histórico: ${escapeHtml(err.message)}</text>`;
  }
}

function renderStats() {
  const { tag, points } = app.detail;
  const cur = app.values[tag.id];
  const stats = [['Actual', cur ? (typeof cur.v === 'number' ? `${fmt(tag, cur.v)} ${tag.unit ?? ''}` : cur.v) : '—']];
  if (tag.type === 'digital') {
    const on = points.filter((p) => tag.onStates?.includes(String(p.v))).length;
    stats.push(['% tiempo en marcha', points.length ? `${Math.round((on / points.length) * 100)} %` : '—']);
  } else {
    const vs = points.map((p) => p.v).filter((v) => typeof v === 'number');
    if (vs.length) {
      const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
      stats.push(['Mínimo', `${fmt(tag, Math.min(...vs))}`], ['Promedio', `${fmt(tag, avg)}`], ['Máximo', `${fmt(tag, Math.max(...vs))}`]);
    }
  }
  stats.push(['Muestras', points.length.toLocaleString(LOCALE)]);
  $('#d-stats').replaceChildren(...stats.map(([k, v]) => el('div', { class: 'stat' }, el('span', {}, k), el('b', {}, String(v)))));
}

function chartModel() {
  const { tag, points } = app.detail;
  const digital = tag.type === 'digital';
  const pts = points
    .map((p) => ({ t: p.t, raw: p.v, v: digital ? (tag.onStates?.includes(String(p.v)) ? 1 : 0) : p.v }))
    .filter((p) => typeof p.v === 'number');
  return { tag, digital, pts };
}

function drawChart() {
  const svg = $('#d-chart');
  const { tag, digital, pts } = chartModel();
  const W = svg.clientWidth || 800, H = svg.clientHeight || 320;
  const m = { l: 58, r: 34, t: 14, b: 28 };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  if (pts.length < 2) {
    svg.innerHTML = '<text class="empty" x="50%" y="50%" text-anchor="middle">Sin datos en el rango seleccionado</text>';
    return;
  }
  const x0 = pts[0].t, x1 = pts.at(-1).t;
  let y0, y1;
  if (digital) { y0 = -0.15; y1 = 1.15; } else {
    const vs = pts.map((p) => p.v);
    y0 = Math.min(...vs); y1 = Math.max(...vs);
    // incluir límites cercanos para dar contexto
    for (const v of Object.values(tag.limits ?? {})) if (v >= y0 - (y1 - y0) && v <= y1 + (y1 - y0)) { y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
    const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.08;
    y0 -= pad; y1 += pad;
  }
  const sx = (t) => m.l + ((t - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (v) => H - m.b - ((v - y0) / (y1 - y0)) * (H - m.t - m.b);

  let g = '<g class="grid">';
  const yTicks = digital ? [0, 1] : niceTicks(y0, y1, 5);
  for (const v of yTicks) {
    const y = sy(v).toFixed(1);
    const label = digital ? (v ? 'Marcha' : 'Detenida') : fmt(tag, v, true);
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text x="${m.l - 8}" y="${y}" dy="4" text-anchor="end">${escapeHtml(label)}</text>`;
  }
  const nx = Math.max(2, Math.min(7, Math.floor((W - m.l - m.r) / 110)));
  const long = x1 - x0 > 26 * 3_600_000;
  for (let i = 0; i <= nx; i++) {
    const t = x0 + ((x1 - x0) * i) / nx;
    const label = long
      ? new Date(t).toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : new Date(t).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
    g += `<text x="${sx(t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${label}</text>`;
  }
  g += '</g>';

  let lims = '';
  if (!digital) {
    for (const [k, v] of Object.entries(tag.limits ?? {})) {
      if (v < y0 || v > y1) continue;
      const K = k.toUpperCase(), y = sy(v).toFixed(1);
      lims += `<line class="lim lim-${K}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/><text class="lim-label" x="${W - m.r + 4}" y="${y}" dy="4">${K}</text>`;
    }
  }

  let d = '';
  pts.forEach((p, i) => {
    const x = sx(p.t).toFixed(1), y = sy(p.v).toFixed(1);
    if (i === 0) d = `M${x},${y}`;
    else d += digital ? `H${x}V${y}` : `L${x},${y}`;
  });
  const area = `${d}L${sx(x1).toFixed(1)},${sy(y0)}L${sx(x0).toFixed(1)},${sy(y0)}Z`;

  svg.innerHTML = `${g}<path class="area" d="${area}"/>${lims}<path class="line" d="${d}"/>
    <g class="cursor" visibility="hidden"><line y1="${m.t}" y2="${H - m.b}"/><circle r="4.5"/></g>`;
  svg._scale = { sx, sy, x0, x1, m, W, pts, digital, tag };
}

function onChartHover(e) {
  const svg = e.currentTarget;
  const s = svg._scale;
  if (!s) return;
  const rect = svg.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * s.W;
  const t = s.x0 + ((x - s.m.l) / (s.W - s.m.l - s.m.r)) * (s.x1 - s.x0);
  let lo = 0, hi = s.pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (s.pts[mid].t < t) lo = mid; else hi = mid; }
  const p = Math.abs(s.pts[lo].t - t) < Math.abs(s.pts[hi].t - t) ? s.pts[lo] : s.pts[hi];
  const px = s.sx(p.t), py = s.sy(p.v);
  const cur = svg.querySelector('.cursor');
  cur.setAttribute('visibility', 'visible');
  cur.querySelector('line').setAttribute('x1', px); cur.querySelector('line').setAttribute('x2', px);
  cur.querySelector('circle').setAttribute('cx', px); cur.querySelector('circle').setAttribute('cy', py);
  const tip = $('#d-tip');
  tip.hidden = false;
  tip.innerHTML = `<b>${escapeHtml(s.digital ? String(p.raw) : `${fmt(s.tag, p.v)} ${s.tag.unit ?? ''}`)}</b><br>${new Date(p.t).toLocaleString(LOCALE)}`;
  tip.style.left = `${(px / s.W) * rect.width}px`;
  tip.style.top = `${(py / (svg.clientHeight || 320)) * rect.height}px`;
}

function downloadCsv() {
  const { tag, range, points } = app.detail;
  if (!points.length) return;
  const rows = ['fecha_hora;valor;unidad', ...points.map((p) => {
    const v = typeof p.v === 'number' ? String(+p.v.toFixed(6)).replace('.', ',') : p.v;
    return `${new Date(p.t).toLocaleString(LOCALE)};${v};${tag.unit ?? ''}`;
  })];
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${tag.id}_${range}.csv` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// ------------------------------------------------------------- helpers ---
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of children) if (c != null) n.append(c);
  return n;
}

function fmt(tag, v, compact = false) {
  const d = compact ? Math.min(tag.decimals ?? 1, 2) : tag.decimals ?? 1;
  return Number(v).toLocaleString(LOCALE, { minimumFractionDigits: compact ? 0 : d, maximumFractionDigits: d });
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function pct(tag, v) {
  if (tag.min == null || tag.max == null || tag.max === tag.min) return 0;
  return Math.max(0, Math.min(100, ((v - tag.min) / (tag.max - tag.min)) * 100));
}

function limitsText(tag, long = false) {
  const l = tag.limits;
  if (!l) return '';
  const parts = ['ll', 'l', 'h', 'hh'].filter((k) => l[k] != null).map((k) => `${k.toUpperCase()} ${fmt(tag, l[k], true)}`);
  return long ? `Límites: ${parts.join(' · ')} ${tag.unit ?? ''}` : parts.join(' · ');
}

function niceTicks(lo, hi, n) {
  const span = hi - lo;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= step0) ?? 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
