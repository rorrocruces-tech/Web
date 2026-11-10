// Envía SMS cuando un equipo se DETIENE (proveedor httpSMS o Twilio; canal SMS o WhatsApp).
//
// Un equipo se considera "en marcha" si su valor digital está en `tag.onStates`.
// Se avisa solo en el FLANCO marcha -> detenido (no en cada ciclo de polling),
// con un tiempo de espera (cooldown) por equipo para evitar reenvíos si el
// estado oscila. Si el estado de detención coincide con `tag.alarmStates`
// (Falla / Trip), el mensaje se marca como FALLA.
//
// Queda APAGADO salvo que SMS_ENABLED=true y estén definidos SMS_API_KEY,
// SMS_FROM y al menos un destinatario. Si falta algo, no hace nada y el
// tablero sigue funcionando igual.

const prevRunning = new Map(); // id -> true (marcha) | false (detenido) | undefined (aún sin dato)
const lastSent = new Map(); // id -> timestamp del último SMS

// La configuración se lee de forma perezosa (lazy) en el primer uso, NO al
// importar el módulo: así server.js ya cargó el .env antes de leer estas
// variables. (De lo contrario SMS_* estarían indefinidas y quedaría apagado.)
let CFG = null;
function cfg() {
  if (CFG) return CFG;
  const PROVIDER = (process.env.SMS_PROVIDER || 'httpsms').toLowerCase();
  const FROM = process.env.SMS_FROM || '';
  const TO = parseList(process.env.SMS_TO);
  // Credenciales httpSMS
  const KEY = process.env.SMS_API_KEY || '';
  // Credenciales Twilio
  const TW_SID = process.env.TWILIO_ACCOUNT_SID || '';
  const TW_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';

  const credentialsOk =
    PROVIDER === 'twilio' ? Boolean(TW_SID) && Boolean(TW_TOKEN) : Boolean(KEY);

  CFG = {
    PROVIDER,
    CHANNEL: (process.env.SMS_CHANNEL || 'sms').toLowerCase(), // sms | whatsapp (solo Twilio)
    API: process.env.SMS_API_URL || 'https://api.httpsms.com/v1/messages/send',
    KEY,
    TW_SID,
    TW_TOKEN,
    FROM,
    TO,
    TO_FALLA: parseList(process.env.SMS_TO_FALLA),
    COOLDOWN_MS: Math.max(0, Number(process.env.SMS_COOLDOWN_MIN || 30)) * 60_000,
    TIMEOUT_MS: Math.max(2000, Number(process.env.SMS_TIMEOUT_MS || 15_000)),
    ENABLED: process.env.SMS_ENABLED === 'true' && credentialsOk && Boolean(FROM) && TO.length > 0,
  };
  return CFG;
}

export function smsEnabled() {
  return cfg().ENABLED;
}

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isRunning(tag, raw) {
  // Devuelve true (en marcha), false (detenido) o null (sin dato / no evaluable).
  if (!raw || raw.good !== true) return null;
  // Equipo digital: en marcha si el estado está en onStates (ej: "Marcha", "Run").
  if (Array.isArray(tag.onStates)) return tag.onStates.includes(String(raw.v));
  // Equipo analógico: en marcha si el valor supera un umbral (ej: potencia > 3500 kW).
  if (typeof tag.runningAbove === 'number' && typeof raw.v === 'number') return raw.v > tag.runningAbove;
  return null;
}

async function sendSms(to, content) {
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.TIMEOUT_MS);
  try {
    let res;
    if (c.PROVIDER === 'twilio') {
      // Twilio: POST form-urlencoded con autenticación Basic (SID:Token).
      const url = `https://api.twilio.com/2010-04-01/Accounts/${c.TW_SID}/Messages.json`;
      const auth = Buffer.from(`${c.TW_SID}:${c.TW_TOKEN}`).toString('base64');
      // Para WhatsApp, Twilio exige el prefijo "whatsapp:" en From y To.
      const pref = c.CHANNEL === 'whatsapp' ? 'whatsapp:' : '';
      const form = new URLSearchParams({ To: `${pref}${to}`, Body: content });
      // El remitente puede ser un número (+569...) o un Messaging Service (MG...).
      if (c.FROM.startsWith('MG')) form.set('MessagingServiceSid', c.FROM);
      else form.set('From', `${pref}${c.FROM}`);
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: ctrl.signal,
      });
    } else {
      // httpSMS: POST JSON con cabecera x-api-key.
      res = await fetch(c.API, {
        method: 'POST',
        headers: { 'x-api-key': c.KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: c.FROM, to, content }),
        signal: ctrl.signal,
      });
    }
    if (!res.ok) throw new Error(`${c.PROVIDER} respondió ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

// Llamar una vez por ciclo de polling, con los valores ya evaluados.
// `values` es el objeto { id: { v, good, alarm, ... } } que arma server.js.
export async function notify(tags, values) {
  const { ENABLED, TO, TO_FALLA, COOLDOWN_MS } = cfg();
  if (!ENABLED) return;
  const now = Date.now();

  for (const tag of tags) {
    const running = isRunning(tag, values[tag.id]);
    if (running === null) continue; // sin dato válido: no cambiamos nada

    const was = prevRunning.get(tag.id);
    prevRunning.set(tag.id, running);

    // Solo avisa en un CAMBIO de estado (no en el primer dato ni si sigue igual).
    if (was === undefined || was === running) continue;

    // Dirección del cambio: 'stop' (se detuvo) o 'start' (volvió a servicio).
    const dir = running ? 'start' : 'stop';
    // Se puede desactivar el aviso de "en servicio" por equipo (notifyOnStart:false).
    if (dir === 'start' && tag.notifyOnStart === false) continue;

    // Cooldown por equipo Y por dirección: no reenvía el mismo tipo de aviso
    // seguido, pero un "detenido" no bloquea el posterior "en servicio".
    const key = `${tag.id}|${dir}`;
    if (now - (lastSent.get(key) || 0) < COOLDOWN_MS) continue;
    lastSent.set(key, now);

    const hora = new Date(now).toLocaleString('es-CL', { hour12: false });
    const base = Array.isArray(tag.notify) && tag.notify.length ? tag.notify : TO;
    let content;
    let destinatarios;

    if (!running) {
      // DETENCIÓN. Si el estado coincide con alarmStates (digital), es FALLA.
      const estado = String(values[tag.id].v);
      const esFalla = Array.isArray(tag.alarmStates) && tag.alarmStates.includes(estado);
      content = esFalla
        ? `🔴 FALLA: ${tag.name} se detuvo (${estado}) — ${hora}`
        : `⚠️ DETENIDO: ${tag.name} — ${hora}`;
      destinatarios = esFalla ? [...new Set([...base, ...TO_FALLA])] : base;
    } else {
      // VUELTA A SERVICIO.
      content = `✅ EN SERVICIO: ${tag.name} volvió a operar — ${hora}`;
      destinatarios = base;
    }

    for (const to of destinatarios) {
      sendSms(to, content).catch((e) => console.error(`[sms] ${tag.id} -> ${to}: ${e.message}`));
    }
    console.log(`[sms] ${content} -> ${destinatarios.join(', ')}`);
  }
}
