// Prueba de envío de UN SMS (httpSMS o Twilio), leyendo la configuración del .env.
// Muestra en pantalla el resultado exacto (o el error) para diagnosticar.
// Uso: node server/probar-sms.js            -> envía al primer número de SMS_TO
//      node server/probar-sms.js +569XXXXXXXX -> envía a ese número

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Cargar .env (mismo criterio que server.js)
for (const line of fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m || line.trim().startsWith('#')) continue;
  const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
  if (process.env[m[1]] === undefined) process.env[m[1]] = val;
}

const PROVIDER = (process.env.SMS_PROVIDER || 'httpsms').toLowerCase();
const FROM = process.env.SMS_FROM || '';
const TO = process.argv[2] || (process.env.SMS_TO || '').split(',')[0].trim();
const content = `Prueba ${PROVIDER} del tablero — ${new Date().toLocaleString('es-CL', { hour12: false })}`;

console.log('--- Prueba de SMS ---');
console.log('PROVEEDOR :', PROVIDER);
console.log('FROM      :', FROM);
console.log('TO        :', TO);

const faltan = [];
if (!FROM) faltan.push('SMS_FROM');
if (!TO) faltan.push('SMS_TO (o pásalo como argumento)');

let fetchOpts;
let url;
if (PROVIDER === 'twilio') {
  const SID = process.env.TWILIO_ACCOUNT_SID || '';
  const TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
  console.log('SID       :', SID ? `${SID.slice(0, 6)}… (${SID.length} car.)` : '(VACÍO ❌)');
  console.log('TOKEN     :', TOKEN ? `(definido, ${TOKEN.length} car.)` : '(VACÍO ❌)');
  if (!SID) faltan.push('TWILIO_ACCOUNT_SID');
  if (!TOKEN) faltan.push('TWILIO_AUTH_TOKEN');
  if (!faltan.length) {
    url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;
    const form = new URLSearchParams({ To: TO, Body: content });
    if (FROM.startsWith('MG')) form.set('MessagingServiceSid', FROM);
    else form.set('From', FROM);
    const auth = Buffer.from(`${SID}:${TOKEN}`).toString('base64');
    fetchOpts = { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form };
  }
} else {
  const KEY = process.env.SMS_API_KEY || '';
  url = process.env.SMS_API_URL || 'https://api.httpsms.com/v1/messages/send';
  console.log('URL       :', url);
  console.log('KEY       :', KEY ? `(definida, ${KEY.length} car.)` : '(VACÍA ❌)');
  if (!KEY || KEY === 'pegue_aqui_su_api_key_de_httpsms') faltan.push('SMS_API_KEY (pon tu clave real)');
  if (!faltan.length) {
    fetchOpts = { method: 'POST', headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: FROM, to: TO, content }) };
  }
}

if (faltan.length) {
  console.log('\nFaltan datos en el .env:', faltan.join(', '));
  process.exit(1);
}

try {
  const res = await fetch(url, fetchOpts);
  const texto = await res.text();
  console.log(`\nRespuesta HTTP: ${res.status} ${res.statusText}`);
  console.log(texto.slice(0, 600));
  if (res.ok) {
    console.log('\n✅ ACEPTADO. El SMS debe llegar al teléfono en segundos.');
    if (PROVIDER === 'twilio') console.log('   (Cuenta de prueba Twilio: solo envía a números verificados y antepone "Sent from your Twilio trial account".)');
    else console.log('   Si no llega: el Android central debe tener señal, saldo y la app httpSMS abierta.');
  } else {
    console.log('\n❌ RECHAZADO. Pistas:');
    if (PROVIDER === 'twilio') {
      console.log('   401 = SID/Token incorrectos  ·  21608 = en prueba, el número destino no está verificado');
      console.log('   21211 = número "To" mal escrito  ·  21606/21612 = el "From" no es un número Twilio válido');
    } else {
      console.log('   401 = API Key incorrecta  ·  422 = número mal escrito o "from" no coincide con el teléfono');
    }
  }
} catch (e) {
  console.log('\n❌ No se pudo conectar:', e.message);
  console.log('   Revisa que el PC pueda llegar a la API (firewall/proxy de la empresa).');
}
