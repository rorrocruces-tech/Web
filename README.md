# Tablero en línea · Sistema de Agua Potable (PI System)

Página web que muestra en tiempo real los valores del sistema de agua potable
(captación, planta, estanques, red y energía) leyendo los tags desde **PI System**
a través de **PI Web API**.

## Arquitectura

```
 Navegadores ──SSE (push)──►  Servidor Node.js  ──HTTPS (polling 5 s)──►  PI Web API ──► PI Data Archive / AF
   (N usuarios)               - 1 sola consulta para todos                 (streamsets/value,
                              - alarmas LL/L/H/HH                           streams/{id}/interpolated)
                              - credenciales sólo en el servidor
```

- **Backend** (`server/`): Node.js sin dependencias externas.
  - Resuelve el `WebId` de cada tag una vez (`points?path=` o `attributes?path=` para atributos AF).
  - Lee **todos los valores actuales en una sola llamada** (`streamsets/value`, en lotes de 40).
  - Evalúa calidad (`Good`), datos antiguos (*stale*) y límites de alarma.
  - Envía los valores a todos los navegadores por **Server-Sent Events**: PI recibe la misma carga con 1 o con 100 usuarios.
  - Entrega tendencias (`streams/{webId}/interpolated`) con caché de 30 s.
  - Si no se configura `PI_WEBAPI_URL`, arranca en **modo simulación** para desarrollar sin PI.
- **Frontend** (`public/`): HTML + CSS + JS puro, sin CDN (funciona en redes OT sin internet).
  - Tarjetas por área con valor, barra con límites, *sparkline* de los últimos 30 min.
  - Estanques con visual de nivel y % de capacidad; bombas con estado Marcha/Detenida/Falla.
  - Panel de **alarmas activas** ordenado por severidad.
  - Clic en una tarjeta → **tendencia histórica** (1 h, 8 h, 24 h, 7 d, 30 d), mín/prom/máx y **descarga CSV**.
  - Indicadores de conexión, datos antiguos, calidad mala ("I/O Timeout", "Comm Fail"…).
  - Tema claro/oscuro automático y diseño responsivo (celular / tablet / pantalla de sala de control).

## Puesta en marcha

Requisitos: Node.js 18 o superior, y acceso de red desde el servidor hacia PI Web API.

```bash
# 1) Probar en modo simulación
npm start                     # http://localhost:3000

# 2) Conectar a PI
cp .env.example .env          # completar PI_WEBAPI_URL, PI_USER, PI_PASSWORD
npm start
```

Con Docker:

```bash
docker build -t tablero-agua .
docker run -d -p 3000:3000 --env-file .env --name tablero-agua tablero-agua
```

Endpoints útiles: `/api/health` (para monitoreo), `/api/snapshot`, `/api/history?id=<tag>&range=8h`.

## Configurar sus tags (`config/tags.json`)

Cada tag de PI se declara una vez:

```json
{
  "id": "planta_cloro",                       // identificador interno único
  "name": "Cloro libre residual",             // texto en pantalla
  "path": "\\\\PISRV01\\AP_PTA_AIT303_CL2",   // \\SERVIDOR_PI\TAG  (o \\AF\BD\Elemento|Atributo)
  "type": "analog",                           // analog | level | digital
  "unit": "mg/l",
  "decimals": 2,
  "min": 0, "max": 3,                         // escala de la barra / estanque
  "limits": { "ll": 0.2, "l": 0.4, "h": 1.8, "hh": 2.0 },
  "note": "NCh409/1: 0,2 – 2,0 mg/l"
}
```

Para tags digitales: `"onStates": ["ON","Marcha"]` y `"alarmStates": ["Falla","Trip"]`.
El bloque `sim` sólo se usa en modo simulación y puede omitirse.

> Recuerde que en JSON cada `\` se escribe `\\`; `\\PISRV01\TAG` queda `"\\\\PISRV01\\TAG"`.

### Requisitos en PI Web API

- Cuenta de servicio de **solo lectura** (identidad PI mapeada con permiso *Read* en los puntos).
- Habilitar autenticación **Basic** en PI Web API (`System Configuration → AuthenticationMethods`) o
  publicar el tablero detrás de un proxy que haga Kerberos (ver mejoras).
- Si PI Web API usa un certificado de la CA interna, indicar el `.pem` en `PI_CA_FILE`.
  Evite `PI_REJECT_UNAUTHORIZED=false` fuera de pruebas.

## Mejoras recomendadas

Ordenadas por impacto para un sistema de agua potable.

### Operación y alarmas
1. **Usar límites de PI/AF en vez de `tags.json`**: leer los atributos de límite de AF (`Hi`, `HiHi`, `Lo`, `LoLo`)
   o los *Event Frames* de alarmas, para que exista una sola fuente de verdad.
2. **Notificaciones**: correo / Teams / SMS cuando una alarma crítica persiste más de N minutos
   (cloro < 0,2 mg/l, turbiedad > 2 NTU, nivel LL de estanque, falla de bomba). Agregar *deadband* y retardo para evitar alarmas intermitentes.
3. **Reconocimiento de alarmas** con usuario y comentario, y bitácora de turno.
4. **Sinóptico P&ID** en SVG (pozos → planta → estanques → red) con los valores sobre el diagrama.
5. **Alarma sonora** opcional en la sala de control y modo pantalla completa/kiosco.

### Indicadores (KPI)
6. **Cumplimiento NCh409/1**: % del tiempo con cloro libre y turbiedad dentro de norma (por día/mes), exportable para informes a la SISS.
7. **Balance hídrico y agua no facturada**: producción (totalizadores) vs. entrega a red / facturación.
8. **Eficiencia energética**: kWh/m³ por pozo y por planta; horas de marcha y partidas de bombas.
9. **Autonomía de estanques**: horas restantes = volumen disponible / (salida − entrada).
10. **Caudal mínimo nocturno** (02:00–05:00) por sector como indicador de fugas.

### Rendimiento y datos
11. **PI Web API Channels (WebSocket)** o `streamsets/updates` (*markers*) en lugar de polling: sólo se reciben los cambios y baja la latencia.
12. Para muchos tags, usar el endpoint **`batch`** de PI Web API y `PlotValues` para tendencias largas (mantiene picos sin traer millones de puntos).
13. Usar **AF Element Templates** para descubrir automáticamente pozos/estanques nuevos sin editar el JSON.

### Seguridad
14. Publicar detrás de **IIS / Nginx con HTTPS** y **autenticación corporativa** (Azure AD / Entra ID, ADFS o LDAP) con roles (operador, jefatura, visitante).
15. Ubicar el servidor en la **DMZ industrial** (modelo Purdue / ISA-62443): el tablero sólo lee de PI, nunca escribe en el SCADA. Si se necesita acceso desde internet, usar un **PI-to-PI** o réplica en la red corporativa en lugar de exponer PI.
16. Guardar la contraseña de PI en un gestor de secretos (Windows Credential Manager, Azure Key Vault) o usar Kerberos con cuenta gMSA.

### Plataforma
17. **PWA** instalable en celulares para operadores en terreno, con notificaciones push.
18. Ejecutar como **servicio de Windows** (p. ej. con `nssm`) o contenedor con reinicio automático, y monitorear `/api/health`.
19. Pruebas automatizadas del cliente PI con un *mock* de PI Web API y pipeline CI.
20. Alternativas listas de AVEVA si prefiere no desarrollar: **PI Vision** (pantallas web nativas) o **AVEVA Data Hub** para acceso en la nube.

## Estructura

```
config/tags.json        Definición de áreas y tags
server/server.js        Servidor HTTP, polling, SSE y API
server/pi-client.js     Cliente PI Web API
server/simulator.js     Datos simulados para desarrollo
server/alarms.js        Evaluación de límites, calidad y datos antiguos
public/                 Interfaz web (index.html, app.js, styles.css)
```
