// Fuente de datos simulada: permite desarrollar y probar el tablero sin acceso a PI.
// Los valores son función pura del tiempo, así la historia y el valor en línea son coherentes.

const EPOCH = Date.UTC(2026, 0, 1);
const frac = (x) => x - Math.floor(x);
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 1000;

export class Simulator {
  constructor() {
    this.name = 'sim';
  }

  valueAt(tag, t) {
    const s = tag.sim ?? {};
    const seed = hash(tag.id);
    if (s.kind === 'digital' || tag.type === 'digital') {
      const period = (s.periodMin ?? 30) * 60_000;
      const n = Math.floor(t / period);
      const on = frac(Math.sin(n * 12.9898 + seed) * 43758.5453) < (s.dutyOn ?? 0.7);
      return on ? (s.on ?? 'ON') : (s.off ?? 'OFF');
    }
    if (s.kind === 'counter') {
      return (s.start ?? 0) + ((s.ratePerHour ?? 0) * (t - EPOCH)) / 3_600_000;
    }
    const period = (s.periodMin ?? 60) * 60_000;
    const wave = Math.sin((2 * Math.PI * t) / period + seed);
    const noise =
      Math.sin(t / 7_000 + seed) * 0.5 + Math.sin(t / 2_300 + seed * 1.7) * 0.3 + Math.sin(t / 900 + seed * 2.3) * 0.2;
    let v = (s.base ?? 50) + (s.amp ?? 10) * wave + (s.noise ?? 1) * noise;
    if (tag.min !== undefined) v = Math.max(tag.min, v);
    if (tag.max !== undefined) v = Math.min(tag.max, v);
    return v;
  }

  async current(tags) {
    const now = Date.now();
    const ts = new Date(now).toISOString();
    return new Map(
      tags.map((tag) => {
        const v = this.valueAt(tag, now);
        return [tag.id, { v, t: ts, good: true, digital: typeof v === 'string' }];
      }),
    );
  }

  async history(tag, range) {
    const end = Date.now();
    const pts = [];
    for (let t = end - range.ms; t <= end; t += range.stepMs) pts.push({ t, v: this.valueAt(tag, t) });
    return pts;
  }
}
