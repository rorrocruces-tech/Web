// Envía los DOS avisos reales (DETENIDO y EN SERVICIO) de inmediato, usando la
// configuración del .env, para ver cómo llegan sin esperar al simulador.
// Uso: node server/probar-aviso.js ["Nombre equipo"] [+569destino]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const line of fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m || line.trim().startsWith('#')) continue;
  const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
  if (process.env[m[1]] === undefined) process.env[m[1]] = val;
}

const PROVIDER = (process.env.SMS_PROVIDER || 'httpsms').toLowerCase();
const CHANNEL = (process.env.SMS_CHANNEL || 'sms').toLowerCase();
const FROM = process.env.SMS_FROM || '';
const TO = process.argv[3] || (process.env.SMS_TO || '').split(',')[0].trim();
const NOMBRE = process.argv[2] || 'Molino SAG';

async function enviar(content) {
  let url;
  let opts;
  if (PROVIDER === 'twilio') {
    const SID = process.env.TWILIO_ACCOUNT_SID || '';
    const TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
    const pref = CHANNEL === 'whatsapp' ? 'whatsapp:' : '';
    url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
    const form = new URLSearchParams({ To: `${pref}${TO}`, Body: content });
    if (FROM.startsWith('MG')) form.set('MessagingServiceSid', FROM);
    else form.set('From', `${pref}${FROM}`);
    opts = { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form };
  } else {
    url = process.env.SMS_API_URL || 'https://api.httpsms.com/v1/messages/send';
    opts = { method: 'POST', headers: { 'x-api-key': process.env.SMS_API_KEY || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: TO, content }) };
  }
  const res = await fetch(url, opts);
  const txt = await res.text();
  return { ok: res.ok, status: res.status, txt };
}

const hora = new Date().toLocaleString('es-CL', { hour12: false });
const avisos = [
  `⚠️ DETENIDO: ${NOMBRE} — ${hora}`,
  `✅ EN SERVICIO: ${NOMBRE} volvió a operar — ${hora}`,
];

console.log('--- Prueba de avisos (detención y vuelta a servicio) ---');
console.log('PROVEEDOR:', PROVIDER, '| canal:', CHANNEL, '| para:', TO);
if (!FROM || !TO) {
  console.log('\nFaltan SMS_FROM o SMS_TO en el .env.');
  process.exit(1);
}

for (const a of avisos) {
  try {
    const r = await enviar(a);
    console.log(`\n[${r.ok ? 'OK' : 'ERROR'} HTTP ${r.status}] ${a}`);
    if (!r.ok) console.log('   ' + r.txt.slice(0, 300));
  } catch (e) {
    console.log(`\n[FALLO] ${a}\n   ${e.message}`);
  }
}
console.log('\nListo. Deben llegar 2 mensajes al teléfono.');
