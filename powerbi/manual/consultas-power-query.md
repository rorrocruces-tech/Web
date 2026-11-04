# Consultas Power Query (copiar y pegar)

Para cada bloque: **Inicio → Obtener datos → Consulta en blanco → Editor avanzado**, pegue el código y cambie el nombre de la consulta por el título indicado.

## Parámetros

Créelos en **Inicio → Administrar parámetros → Nuevo parámetro** (requerido, sin valores sugeridos):

| Nombre | Tipo | Valor actual | Para qué |
|---|---|---|---|
| `UrlServidor` | Texto | `http://localhost:3000` | Dirección del servidor del tablero (Node.js) |
| `Dias` | Número decimal | `30` | Días de historia a cargar (desde hoy 00:00 hacia atrás) |
| `Intervalo` | Texto | `15m` | Resolución de los datos: 5m, 15m, 30m, 1h o 1d |

## Consulta `Tags`

```powerquery
let
    Origen = Csv.Document(
        Web.Contents(UrlServidor, [RelativePath = "api/powerbi/tags.csv"]),
        [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
    ),
    Encabezados = Table.PromoteHeaders(Origen, [PromoteAllScalars = true]),
    VaciosANulos = Table.TransformColumns(Encabezados, {}, each if _ = "" then null else _),
    Tipos = Table.TransformColumnTypes(
        VaciosANulos,
        {
            {"TagId", type text}, {"Nombre", type text}, {"Area", type text}, {"OrdenArea", Int64.Type},
            {"Tipo", type text}, {"Kpi", type text}, {"Unidad", type text}, {"Ruta", type text},
            {"Min", type number}, {"Max", type number},
            {"LL", type number}, {"L", type number}, {"H", type number}, {"HH", type number}
        },
        "en-US"
    )
in
    Tipos
```

## Consulta `Valores`

```powerquery
let
    Origen = Csv.Document(
        Web.Contents(
            UrlServidor,
            [
                RelativePath = "api/powerbi/valores.csv",
                Query = [dias = Text.From(Dias), intervalo = Intervalo],
                Timeout = #duration(0, 0, 30, 0)
            ]
        ),
        [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]
    ),
    Encabezados = Table.PromoteHeaders(Origen, [PromoteAllScalars = true]),
    VaciosANulos = Table.TransformColumns(Encabezados, {}, each if _ = "" then null else _),
    Tipos = Table.TransformColumnTypes(
        VaciosANulos,
        {
            {"FechaHora", type datetime}, {"TagId", type text}, {"Valor", type number},
            {"Texto", type text}, {"Alarma", type text}, {"Marcha", Int64.Type}, {"IntervaloHoras", type number}
        },
        "en-US"
    ),
    ConFecha = Table.AddColumn(Tipos, "Fecha", each DateTime.Date([FechaHora]), type date),
    ConHora = Table.AddColumn(ConFecha, "Hora", each Time.Hour([FechaHora]), Int64.Type)
in
    ConHora
```

## Consulta `Calendario`

```powerquery
let
    Inicio = Date.AddDays(Date.From(DateTime.LocalNow()), -Dias),
    Fechas = List.Dates(Inicio, Dias + 1, #duration(1, 0, 0, 0)),
    Tabla = Table.FromList(Fechas, Splitter.SplitByNothing(), type table [Fecha = date]),
    Anio = Table.AddColumn(Tabla, "Año", each Date.Year([Fecha]), Int64.Type),
    Mes = Table.AddColumn(Anio, "Mes", each Date.Month([Fecha]), Int64.Type),
    AnioMes = Table.AddColumn(Mes, "AñoMes", each Date.Year([Fecha]) * 100 + Date.Month([Fecha]), Int64.Type),
    NombreMes = Table.AddColumn(AnioMes, "NombreMes", each Date.ToText([Fecha], "MMM yyyy", "es-CL"), type text),
    NumDia = Table.AddColumn(NombreMes, "NumDiaSemana", each Date.DayOfWeek([Fecha], Day.Monday) + 1, Int64.Type),
    DiaSemana = Table.AddColumn(NumDia, "DiaSemana", each Date.ToText([Fecha], "dddd", "es-CL"), type text)
in
    DiaSemana
```
