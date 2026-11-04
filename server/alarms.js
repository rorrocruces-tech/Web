// Evalúa calidad, antigüedad y límites de alarma (LL / L / H / HH) de un valor.

export function evaluate(tag, raw, now, defaultStaleSec) {
  const out = { ...raw, alarm: null, stale: false };
  if (raw.t) {
    const ageSec = (now - Date.parse(raw.t)) / 1000;
    out.stale = ageSec > (tag.staleSeconds ?? defaultStaleSec);
  }
  if (!raw.good) return out;

  if (tag.type === 'digital') {
    if (tag.alarmStates?.includes(String(raw.v))) out.alarm = 'DIG';
    return out;
  }
  if (typeof raw.v !== 'number' || !tag.limits) return out;

  const { ll, l, h, hh } = tag.limits;
  const v = raw.v;
  if (hh != null && v >= hh) out.alarm = 'HH';
  else if (ll != null && v <= ll) out.alarm = 'LL';
  else if (h != null && v >= h) out.alarm = 'H';
  else if (l != null && v <= l) out.alarm = 'L';
  return out;
}
