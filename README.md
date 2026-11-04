# Tablero en línea · Sistema de Agua Potable (PI System)

Página web que muestra en tiempo real los valores del sistema de agua potable
(captación, planta, estanques, red y energía) leyendo los tags desde **PI System**.

Puede leer los datos de dos formas:

| Fuente (`PI_SOURCE`) | Cuándo usarla | Requisitos |
|---|---|---|
| **`pisdk`** | Sólo tiene **PI ProcessBook** (p. ej. 3.2) y no tiene PI Web API | PC Windows con ProcessBook funcionando + Node.js |
| `webapi` | Su servidor PI tiene **PI Web API** instalado | Cualquier servidor con acceso HTTPS a PI Web API |
| `sim` | Desarrollo / demostración sin PI | Nada |

## Arquitectura

```
                                              ┌─ pisdk ─► PowerShell + PI SDK (COM, el de ProcessBook) ─┐
 Navegadores ◄─SSE─ Servidor Node.js (polling)┤                                                         ├─► PI Data Archive
  (N usuarios)      1 consulta para todos     └─ webapi ─► HTTPS ─► PI Web API ─────────────────────────┘
                    alarmas LL/L/H/HH
```

- **Backend** (`server/`): Node.js sin dependencias externas.
  - Una sola consulta a PI cada `POLL_MS` (5 s) para todos los usuarios; se reparte a los navegadores por **Server-Sent Events**.
  - Evalúa calidad del dato, datos antiguos (*stale*) y límites de alarma.
  - Entrega tendencias interpoladas con caché de 30 s.
  - `pisdk-client.js` + `pisdk-bridge.ps1`: lee snapshot e históricos con el **PI SDK** que instala ProcessBook, usando la misma conexión (trust / usuario por defecto) que ya usa ProcessBook. Si el puente se cae, se reinicia solo.
  - `pi-client.js`: lee de PI Web API (`streamsets/value` en lotes, `streams/{webId}/interpolated`).
- **Frontend** (`public/`): HTML + CSS + JS puro, sin CDN (funciona en redes OT sin internet).
  - Tarjetas por área con valor, barra con límites, *sparkline* de los últimos 30 min.
  - Estanques con visual de nivel y % de capacidad; bombas con estado Marcha/Detenida/Falla.
  - Panel de **alarmas activas** ordenado por severidad.
  - Clic en una tarjeta → **tendencia histórica** (1 h, 8 h, 24 h, 7 d, 30 d), mín/prom/máx y **descarga CSV**.
  - Indicadores de conexión, datos antiguos, calidad mala ("I/O Timeout", "Comm Fail"…).
  - Tema claro/oscuro automático y diseño responsivo (celular / tablet / pantalla de sala de control).

## Puesta en marcha con PI ProcessBook (sin PI Web API)

PI ProcessBook es sólo el cliente: los datos están en un **servidor PI (PI Data Archive)** al que
ProcessBook se conecta usando el **PI SDK**, que se instaló junto con ProcessBook. El tablero usa ese mismo PI SDK.

1. **Elija el PC**: el mismo donde ProcessBook muestra datos (o cualquier Windows con PI SDK y acceso al servidor PI).
   Idealmente un PC/servidor que quede siempre encendido.
2. **Instale Node.js 18 o superior** (LTS, instalador `.msi` de https://nodejs.org). No requiere permisos especiales de PI.
3. **Copie esta carpeta** al PC, por ejemplo `C:\TableroAgua`.
4. **Averigüe el nombre del servidor PI y de sus tags**: en ProcessBook, *File → Connections* / *Archivo → Conexiones* (*PI Connection Manager*)
   muestra el nombre del servidor; los nombres de tag aparecen al hacer doble clic en un valor o tendencia de sus pantallas
   (o con *Tag Search*).
5. **Pruebe la lectura** antes de configurar todo:
   ```bat
   probar-pisdk.bat "\\NOMBRE_SERVIDOR\NOMBRE_TAG" "\\NOMBRE_SERVIDOR\OTRO_TAG"
   ```
   Debe mostrar `OK  ... = valor`. Si dice que no puede cargar PI SDK, vea *Problemas frecuentes*.
6. **Configure los tags** en `config/tags.json` (ver abajo) con el formato `\\NOMBRE_SERVIDOR\NOMBRE_TAG`.
7. **Inicie**: doble clic en `iniciar.bat` (crea `.env` con `PI_SOURCE=pisdk` y abre http://localhost:3000).
8. Desde otros equipos de la red: `http://NOMBRE_DEL_PC:3000` (abra el puerto 3000 en el firewall de Windows).

Para que arranque solo al encender el PC: *Programador de tareas* → tarea "Al iniciar el sistema" que ejecute
`node C:\TableroAgua\server\server.js` con "Iniciar en" = `C:\TableroAgua`, o instálelo como servicio con
[NSSM](https://nssm.cc). Si lo ejecuta como servicio, la cuenta del servicio debe tener acceso a PI
(un *trust* en PI SMT o `PISDK_CONNECT=UID=...;PWD=...` en `.env`).

### Problemas frecuentes (PI SDK)

| Mensaje | Causa / solución |
|---|---|
| `No se pudo cargar PI SDK (PowerShell de 64 bits)` | ProcessBook 3.x es de 32 bits. Use la PowerShell de 32 bits (es la opción por defecto); no defina `PISDK_POWERSHELL`. |
| `No se pudo cargar PI SDK (PowerShell de 32 bits)` | PI SDK no está instalado en ese PC: use el PC donde funciona ProcessBook. |
| Error de acceso / login / *No Read Access* | El usuario de Windows no tiene *trust* en el servidor PI. Pida al administrador PI un trust o un usuario de solo lectura (`PISDK_CONNECT`). |
| `[-11049] Point not found` | El nombre del tag no existe en ese servidor. Revise `path` en `tags.json`. |
| `Timeout esperando a PI SDK` | Servidor PI inalcanzable (puerto TCP 5450) o demasiados tags. Aumente `PI_TIMEOUT_MS`. |
| `execution of scripts is disabled` | El `.bat` ya usa `-ExecutionPolicy Bypass`; si la política está bloqueada por GPO, pida a TI una excepción para `pisdk-bridge.ps1`. |

## Puesta en marcha con PI Web API

```bash
cp .env.example .env          # PI_SOURCE=webapi y completar PI_WEBAPI_URL, PI_USER, PI_PASSWORD
npm start
```

Con Docker (sólo PI Web API o simulación; PI SDK requiere Windows):

```bash
docker build -t tablero-agua .
docker run -d -p 3000:3000 --env-file .env --name tablero-agua tablero-agua
```

Modo simulación, sin PI: `npm run sim`.

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

### Plataforma PI (su caso: ProcessBook 3.2 de 2009)
0. **PI ProcessBook está descontinuado por AVEVA** y la versión 3.2 es de 2009; su PI SDK de 32 bits funciona, pero no recibirá más soporte.
   Consulte con su proveedor/AVEVA:
   - **PI Web API** normalmente está incluido en la licencia de PI Server para clientes con soporte vigente. Instalarlo permite
     usar `PI_SOURCE=webapi`, que es más robusto (no depende de un PC Windows con ProcessBook).
   - **PI Vision** es el reemplazo oficial de ProcessBook (pantallas web) e incluso puede importar pantallas `.PDI`.
   - Verifique la versión de su servidor PI (PI SMT o *About PI-SDK*): versiones muy antiguas pueden requerir actualización antes de PI Web API.

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
server/pisdk-client.js  Cliente PI SDK (lanza el puente PowerShell)
server/pisdk-bridge.ps1 Puente PowerShell ↔ PI SDK (COM) de ProcessBook
iniciar.bat             Inicio rápido en Windows
probar-pisdk.bat        Prueba de lectura de tags con PI SDK
server/simulator.js     Datos simulados para desarrollo
server/alarms.js        Evaluación de límites, calidad y datos antiguos
public/                 Interfaz web (index.html, app.js, styles.css)
```
