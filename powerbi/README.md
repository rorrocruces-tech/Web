# Power BI · Sistema de Agua Potable

Reporte de Power BI con indicadores del sistema de agua potable, alimentado desde PI System
**usando sólo PI ProcessBook / PI SDK** (no requiere PI Web API ni PI Integrator).

```
PI Data Archive ──PI SDK──► Servidor del tablero (Node.js, PC con ProcessBook) ──CSV──► Power BI
                             /api/powerbi/tags.csv                                     (Desktop o servicio
                             /api/powerbi/valores.csv?dias=30&intervalo=15m              con gateway)
```

> **Power BI vs. tablero web.** Power BI se actualiza por **refresco programado** (hasta 8 veces al día con
> licencia Pro), por lo que sirve para **indicadores, informes y análisis** (cumplimiento NCh409, m³,
> kWh/m³, horas de marcha). Para ver valores **segundo a segundo** use el tablero web (`http://PC:3000`).

## Qué incluye

| Archivo | Contenido |
|---|---|
| `AguaPotable.pbip` | Proyecto Power BI listo: abrir con doble clic |
| `AguaPotable.SemanticModel/` | Modelo: 3 parámetros, 3 tablas, 2 relaciones, 29 medidas DAX |
| `AguaPotable.Report/` | 5 páginas: Resumen, Tendencias, Calidad del agua, Producción y energía, Bombas y estanques |
| `manual/consultas-power-query.md` | Las consultas para armarlo a mano (opción B) |
| `manual/medidas-dax.md` | Las medidas DAX para copiar y pegar (opción B) |
| `generar.py` | Regenera todo lo anterior si cambia medidas o páginas (`python3 powerbi/generar.py`) |

### Modelo de datos

```
Tags (1) ──────< Valores >────── (1) Calendario
TagId, Nombre, Area, Kpi,        FechaHora, Fecha, Hora,        Fecha, Año, NombreMes,
Unidad, Min, Max, LL/L/H/HH      TagId, Valor, Texto,           DiaSemana
                                 Alarma, Marcha, IntervaloHoras
```

- **Valores** viene en formato largo: una fila por tag y por intervalo (valores **interpolados** de PI, igual que una tendencia de ProcessBook).
- **Alarma** se calcula con los límites de `config/tags.json` (`L`, `H`, `LL`, `HH`, `DIG` = falla de bomba).
- **Marcha** = 1 si una bomba (tag digital) está en un estado de `onStates`.
- **Kpi** indica el rol de cada tag en las medidas (ver *Agregar sus tags*).

### Medidas principales

| Carpeta | Medidas |
|---|---|
| Básicas | Valor promedio / mínimo / máximo, Último valor, Muestras |
| Alarmas | Horas en alarma, Horas en alarma crítica, % tiempo en alarma, % cumplimiento |
| Calidad agua (NCh409) | % cumplimiento cloro, turbiedad y pH; cloro libre promedio/mínimo; turbiedad máxima |
| Producción y energía | Volumen producido y entregado (m³), diferencia producción–entrega (m³ y %), energía (kWh), **kWh/m³**, caudal mínimo nocturno (fugas) |
| Bombas y estanques | Horas de marcha, % tiempo en marcha, nivel de estanque promedio/mínimo (%), presión mínima/promedio |

---

## Paso a paso

### Paso 1 · Tener el servidor funcionando

1. En el PC con ProcessBook, inicie el tablero con `iniciar.bat` (ver README principal) y configure sus tags en `config/tags.json`.
2. Compruebe en el navegador de ese PC:
   - http://localhost:3000/api/powerbi/tags.csv → descarga la lista de tags.
   - http://localhost:3000/api/powerbi/valores.csv?dias=1&intervalo=15m → descarga los valores del último día.

   Si alguno da error, revise la consola del servidor (normalmente un tag mal escrito).

### Paso 2 · Instalar Power BI Desktop

Gratis desde Microsoft Store (*Power BI Desktop*) o https://powerbi.microsoft.com/desktop.
Instálelo **en el mismo PC** del servidor o en otro PC de la red (en ese caso use `http://NOMBRE_PC:3000` como `UrlServidor`).

### Paso 3 (opción A, recomendada) · Abrir el proyecto ya armado

1. Copie la carpeta `powerbi` completa al PC y haga doble clic en **`AguaPotable.pbip`**.
   - Si Power BI indica que el formato no está habilitado: *Archivo → Opciones y configuración → Opciones →
     Características en versión preliminar* → active **"Guardar proyectos de Power BI (.pbip)"** y
     **"Almacenar el modelo semántico mediante el formato TMDL"**, reinicie Power BI y vuelva a abrir.
2. El reporte abre **sin datos**. Vaya a *Inicio → Transformar datos → Editar parámetros* y revise:
   - `UrlServidor`: `http://localhost:3000` (o `http://NOMBRE_PC:3000`).
   - `Dias`: días de historia (30 para empezar).
   - `Intervalo`: `15m` (ver tabla de tamaños más abajo).
3. *Inicio → **Actualizar***. Si pregunta credenciales para `http://localhost:3000`, elija **Anónimo → Conectar**.
   Si pregunta por niveles de privacidad, elija **Organizativo** para ese origen.
4. Guarde. Desde aquí puede seguir editando visuales, colores y agregar su logo.
   Para obtener un archivo único `.pbix`: *Archivo → Guardar como → Power BI (.pbix)*.

> Si el proyecto no abriera en su versión de Power BI, use la opción B: obtiene el mismo resultado.

### Paso 3 (opción B) · Armarlo a mano (~30 minutos)

1. **Parámetros** – *Inicio → Transformar datos → Administrar parámetros → Nuevo*: cree `UrlServidor` (Texto),
   `Dias` (Número decimal) y `Intervalo` (Texto) con los valores de `manual/consultas-power-query.md`.
2. **Consultas** – *Nueva fuente → Consulta en blanco → Editor avanzado*: pegue las consultas `Tags`, `Valores` y
   `Calendario` de `manual/consultas-power-query.md` (renombre cada consulta con ese nombre). *Cerrar y aplicar*.
3. **Relaciones** – Vista *Modelo*: arrastre `Valores[TagId]` → `Tags[TagId]` y `Valores[Fecha]` → `Calendario[Fecha]`
   (ambas *Varios a uno*, filtro *Único*).
4. **Orden de columnas** – en la vista *Datos*: `Tags[Area]` → *Ordenar por columna* `OrdenArea`;
   `Calendario[NombreMes]` por `AñoMes`; `Calendario[DiaSemana]` por `NumDiaSemana`.
5. **Medidas** – seleccione la tabla `Valores` → *Nueva medida* y pegue cada medida de `manual/medidas-dax.md`
   con su formato. Puede agruparlas en carpetas con *Propiedades → Carpeta para mostrar*.
6. **Páginas** – arme las visualizaciones (use siempre **medidas**, no la columna `Valor` directamente):

   | Página | Visuales |
   |---|---|
   | **Resumen** | Segmentación `Calendario[Fecha]` (entre); tarjetas: Volumen producido, Volumen entregado, Energía, kWh/m³, % cumplimiento cloro, % cumplimiento turbiedad; columnas por `Fecha` con volúmenes; línea por `Fecha` con kWh/m³; línea de cloro libre mínimo/promedio; tabla `Area`, `Nombre`, Horas en alarma, Horas en alarma crítica, % cumplimiento |
   | **Tendencias** | Segmentaciones `Tags[Area]` y `Tags[Nombre]`; línea con eje `Valores[FechaHora]`, valor *Valor promedio*, leyenda `Tags[Nombre]`; tabla con mín/prom/máx/último, % tiempo en alarma |
   | **Calidad del agua** | Tarjetas de cumplimiento cloro/turbiedad/pH, cloro mínimo y turbiedad máxima; línea diaria de cloro; columnas de % cumplimiento diario; línea de turbiedad máxima |
   | **Producción y energía** | Tarjetas de volumen, diferencia, %, caudal mínimo nocturno, kWh/m³; línea de caudal mínimo nocturno; columnas de energía diaria; tabla diaria |
   | **Bombas y estanques** | Tarjetas de horas y % de marcha, nivel promedio/mínimo, presión mínima; columnas de horas de marcha por `Nombre`; líneas diarias de nivel mínimo y presión mínima por `Nombre` |

   Sugerencia: en las tarjetas de cumplimiento use *Formato condicional → Color de fuente* (rojo < 95 %, verde ≥ 99 %).

### Paso 4 · Publicar y actualizar automáticamente (opcional)

Requiere licencia **Power BI Pro** (o Premium por usuario) y acceso a https://app.powerbi.com.

1. *Inicio → Publicar* → elija el área de trabajo.
2. En el **PC del servidor** instale **On-premises data gateway** (https://aka.ms/gateway), inicie sesión con su
   cuenta de Power BI y regístrelo. Ese PC debe quedar encendido.
   - Como el gateway está en el mismo PC, `http://localhost:3000` funciona tal cual.
3. En app.powerbi.com: *Configuración del modelo semántico → Conexión de gateway* → asigne el gateway y cree la
   conexión **Web** a `http://localhost:3000` con autenticación **Anónima**.
4. *Actualización programada*: actívela, zona horaria *Santiago*, y agregue horarios (p. ej. 06:00, 12:00, 18:00).
5. Comparta el reporte con su equipo o cree una *aplicación* del área de trabajo.

### Cantidad de datos recomendada

Con 17 tags (multiplique según su cantidad):

| Dias | Intervalo | Filas | Uso |
|---|---|---|---|
| 7 | 5m | ~39.000 | Análisis operacional fino |
| 30 | 15m | ~50.000 | **Recomendado para empezar** |
| 90 | 30m | ~74.000 | Informe trimestral |
| 365 | 1h | ~150.000 | Informe anual / tendencias de largo plazo |

Con PI SDK la primera carga de un año puede tardar algunos minutos (el servidor guarda el resultado 10 minutos).
Mientras se exporta, el tablero web puede demorar unos segundos en actualizarse.

---

## Agregar sus tags a los indicadores

Las medidas no usan nombres de tags: usan el campo **`kpi`** de `config/tags.json`. Al agregar un tag, asígnele uno:

| `kpi` | Tag | Se usa en |
|---|---|---|
| `produccion` | Caudal de cada pozo/captación (l/s) | Volumen producido, kWh/m³ |
| `entrega_red` | Caudal de salida a red (l/s) | Volumen entregado, caudal mínimo nocturno |
| `entrada_planta` | Caudal de entrada a planta (l/s) | (disponible para medidas propias) |
| `cloro` | Cloro libre residual (mg/l) | Cumplimiento cloro |
| `turbiedad` | Turbiedad agua tratada (NTU) | Cumplimiento turbiedad |
| `turbiedad_cruda` | Turbiedad agua cruda | (disponible) |
| `ph` | pH agua tratada | Cumplimiento pH |
| `potencia` | Potencia eléctrica (kW) | Energía, kWh/m³ |
| `bomba` | Estado de bomba (digital) | Horas y % de marcha |
| `nivel_estanque` | Nivel de estanque (con `min`/`max`) | Nivel % |
| `presion` | Presión de red (mca) | Presión mínima/promedio |
| `nivel_pozo`, `totalizador` | Otros | (disponible) |

Los **límites de cumplimiento** son los `ll`/`hh` de cada tag (por ejemplo cloro `ll: 0.2`, `hh: 2.0`; turbiedad `hh: 2`).
Después de modificar `tags.json`, reinicie el servidor y actualice Power BI.

## Problemas frecuentes

| Problema | Solución |
|---|---|
| *No se puede conectar al servidor remoto* | El servidor no está corriendo o `UrlServidor` está mal. Pruebe la URL de `tags.csv` en el navegador. |
| *La operación agotó el tiempo de espera* | Reduzca `Dias` o aumente `Intervalo`; la consulta espera hasta 30 min. |
| Medidas de volumen/energía en blanco | Ningún tag tiene ese `kpi` en `tags.json`. |
| Volumen distinto al totalizador | El volumen se integra desde el caudal interpolado; con intervalos grandes (1h) pierde precisión. Use 5m–15m, o compare con el totalizador (`kpi: totalizador`). |
| Horas corridas en el servicio | Las fechas llegan en hora local del PC del servidor; verifique la zona horaria de ese PC. |
| En el servicio: *Se necesitan credenciales* | Configure la conexión Web del gateway como **Anónima** (paso 4). |
