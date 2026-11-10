// Prueba de envío de UN SMS vía httpSMS, leyendo la configuración del .env.
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

const API = process.env.SMS_API_URL || 'https://api.httpsms.com/v1/messages/send';
const KEY = process.env.SMS_API_KEY || '';
const FROM = process.env.SMS_FROM || '';
const TO = process.argv[2] || (process.env.SMS_TO || '').split(',')[0].trim();

console.log('--- Prueba de SMS (httpSMS) ---');
console.log('URL  :', API);
console.log('FROM :', FROM);
console.log('TO   :', TO);
console.log('KEY  :', KEY ? `(definida, ${KEY.length} caracteres)` : '(VACÍA ❌)');

const faltan = [];
if (!KEY || KEY === 'pegue_aqui_su_api_key_de_httpsms') faltan.push('SMS_API_KEY (pon tu clave real)');
if (!FROM) faltan.push('SMS_FROM');
if (!TO) faltan.push('SMS_TO (o pásalo como argumento)');
if (faltan.length) {
  console.log('\nFaltan datos en el .env:', faltan.join(', '));
  process.exit(1);
}

const content = `Prueba httpSMS del tablero — ${new Date().toLocaleString('es-CL', { hour12: false })}`;

try {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: TO, content }),
  });
  const texto = await res.text();
  console.log(`\nRespuesta HTTP: ${res.status} ${res.statusText}`);
  console.log(texto);
  if (res.ok) {
    console.log('\n✅ httpSMS ACEPTÓ el mensaje. Debe llegar al teléfono en segundos.');
    console.log('   Si no llega: revisa que el Android central tenga señal, saldo y la app httpSMS abierta.');
  } else {
    console.log('\n❌ httpSMS RECHAZÓ el mensaje. Pistas según el código:');
    console.log('   401 = API Key incorrecta  ·  422 = número mal escrito o "from" no coincide con el del teléfono');
    console.log('   400 = cuerpo inválido      ·  404 = URL equivocada (debe terminar en /v1/messages/send)');
  }
} catch (e) {
  console.log('\n❌ No se pudo conectar a httpSMS:', e.message);
  console.log('   Revisa la conexión a internet del PC (debe poder llegar a api.httpsms.com).');
}
