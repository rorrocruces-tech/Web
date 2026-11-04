#!/usr/bin/env python3
"""
Genera el proyecto Power BI (PBIP) del sistema de agua potable y los archivos
para armarlo a mano (consultas Power Query y medidas DAX), todo desde una única
definición para que siempre estén sincronizados.

Uso:  python3 powerbi/generar.py
Salida:
  powerbi/AguaPotable.pbip                     <- abrir con Power BI Desktop
  powerbi/AguaPotable.SemanticModel/...         modelo (TMDL): parámetros, tablas, relaciones, medidas
  powerbi/AguaPotable.Report/...                páginas del reporte
  powerbi/manual/consultas-power-query.md       consultas M para copiar/pegar
  powerbi/manual/medidas-dax.md                 medidas DAX para copiar/pegar
"""

import json
import os
import shutil

BASE = os.path.dirname(os.path.abspath(__file__))
NAME = "AguaPotable"
SM = f"{NAME}.SemanticModel"
RP = f"{NAME}.Report"

# --------------------------------------------------------------- parámetros
PARAMS = [
    ("UrlServidor", '"http://localhost:3000"', "Text", "Dirección del servidor del tablero (Node.js)"),
    ("Dias", "30", "Number", "Días de historia a cargar (desde hoy 00:00 hacia atrás)"),
    ("Intervalo", '"15m"', "Text", "Resolución de los datos: 5m, 15m, 30m, 1h o 1d"),
]

# --------------------------------------------------------------- consultas M
M_TAGS = """let
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
    Tipos"""

M_VALORES = """let
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
    ConHora"""

M_CALENDARIO = """let
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
    DiaSemana"""

# columnas: (nombre, dataType TMDL, formatString|None, extras)
TABLES = {
    "Tags": {
        "m": M_TAGS,
        "columns": [
            ("TagId", "string", None, {}),
            ("Nombre", "string", None, {}),
            ("Area", "string", None, {"sortByColumn": "OrdenArea"}),
            ("OrdenArea", "int64", "0", {"isHidden": True}),
            ("Tipo", "string", None, {}),
            ("Kpi", "string", None, {}),
            ("Unidad", "string", None, {}),
            ("Ruta", "string", None, {}),
            ("Min", "double", "#,0.##", {}),
            ("Max", "double", "#,0.##", {}),
            ("LL", "double", "#,0.##", {}),
            ("L", "double", "#,0.##", {}),
            ("H", "double", "#,0.##", {}),
            ("HH", "double", "#,0.##", {}),
        ],
    },
    "Valores": {
        "m": M_VALORES,
        "columns": [
            ("FechaHora", "dateTime", "dd-MM-yyyy HH:mm", {}),
            ("TagId", "string", None, {"isHidden": True}),
            ("Valor", "double", "#,0.00", {}),
            ("Texto", "string", None, {}),
            ("Alarma", "string", None, {}),
            ("Marcha", "int64", "0", {}),
            ("IntervaloHoras", "double", "0.####", {"isHidden": True}),
            ("Fecha", "dateTime", "dd-MM-yyyy", {"isHidden": True}),
            ("Hora", "int64", "0", {}),
        ],
    },
    "Calendario": {
        "m": M_CALENDARIO,
        "columns": [
            ("Fecha", "dateTime", "dd-MM-yyyy", {}),
            ("Año", "int64", "0", {}),
            ("Mes", "int64", "0", {"isHidden": True}),
            ("AñoMes", "int64", "0", {"isHidden": True}),
            ("NombreMes", "string", None, {"sortByColumn": "AñoMes"}),
            ("NumDiaSemana", "int64", "0", {"isHidden": True}),
            ("DiaSemana", "string", None, {"sortByColumn": "NumDiaSemana"}),
        ],
    },
}

RELATIONSHIPS = [
    ("Valores_Tags", "Valores", "TagId", "Tags", "TagId"),
    ("Valores_Calendario", "Valores", "Fecha", "Calendario", "Fecha"),
]

# --------------------------------------------------------------- medidas DAX
# (carpeta, nombre, formato, expresión, descripción). Todas viven en la tabla Valores.
# Los KPI se identifican por la columna Tags[Kpi] (definida en config/tags.json),
# así las medidas no dependen del nombre de cada tag.
PCT = "0.0%"
MEASURES = [
    ("1 Básicas", "Valor promedio", "#,0.00", "AVERAGE ( Valores[Valor] )", "Promedio de los valores del tag/periodo filtrado."),
    ("1 Básicas", "Valor mínimo", "#,0.00", "MIN ( Valores[Valor] )", ""),
    ("1 Básicas", "Valor máximo", "#,0.00", "MAX ( Valores[Valor] )", ""),
    ("1 Básicas", "Último valor", "#,0.00",
     "VAR ultimo = CALCULATE ( MAX ( Valores[FechaHora] ), NOT ISBLANK ( Valores[Valor] ) )\n"
     "RETURN CALCULATE ( AVERAGE ( Valores[Valor] ), Valores[FechaHora] = ultimo )",
     "Valor en la última fecha/hora disponible del filtro."),
    ("1 Básicas", "Muestras", "#,0", "COUNTROWS ( Valores )", ""),

    ("2 Alarmas", "Horas en alarma", "#,0.0",
     "CALCULATE ( SUM ( Valores[IntervaloHoras] ), NOT ISBLANK ( Valores[Alarma] ) )",
     "Horas con el valor fuera de algún límite (L, H, LL, HH o falla)."),
    ("2 Alarmas", "Horas en alarma crítica", "#,0.0",
     'CALCULATE ( SUM ( Valores[IntervaloHoras] ), Valores[Alarma] IN { "LL", "HH", "DIG" } )',
     "Horas fuera de los límites críticos LL/HH o con falla."),
    ("2 Alarmas", "% tiempo en alarma", PCT,
     "DIVIDE ( [Horas en alarma], SUM ( Valores[IntervaloHoras] ) )", ""),
    ("2 Alarmas", "% cumplimiento", PCT,
     "1 - DIVIDE ( [Horas en alarma crítica], CALCULATE ( SUM ( Valores[IntervaloHoras] ), NOT ISBLANK ( Valores[Valor] ) ) )",
     "% del tiempo dentro de los límites críticos LL/HH."),

    ("3 Calidad agua (NCh409)", "Cloro libre promedio (mg/l)", "0.00",
     'CALCULATE ( AVERAGE ( Valores[Valor] ), Tags[Kpi] = "cloro" )', ""),
    ("3 Calidad agua (NCh409)", "Cloro libre mínimo (mg/l)", "0.00",
     'CALCULATE ( MIN ( Valores[Valor] ), Tags[Kpi] = "cloro" )', ""),
    ("3 Calidad agua (NCh409)", "% cumplimiento cloro", PCT,
     'CALCULATE ( [% cumplimiento], Tags[Kpi] = "cloro" )',
     "% del tiempo con cloro libre entre los límites LL y HH del tag (NCh409/1: 0,2 – 2,0 mg/l)."),
    ("3 Calidad agua (NCh409)", "Turbiedad máxima (NTU)", "0.00",
     'CALCULATE ( MAX ( Valores[Valor] ), Tags[Kpi] = "turbiedad" )', ""),
    ("3 Calidad agua (NCh409)", "% cumplimiento turbiedad", PCT,
     'CALCULATE ( [% cumplimiento], Tags[Kpi] = "turbiedad" )',
     "% del tiempo con turbiedad bajo el límite HH del tag (NCh409/1: 2 NTU)."),
    ("3 Calidad agua (NCh409)", "% cumplimiento pH", PCT,
     'CALCULATE ( [% cumplimiento], Tags[Kpi] = "ph" )', ""),

    ("4 Producción y energía", "Volumen producido (m³)", "#,0",
     'CALCULATE ( SUMX ( Valores, Valores[Valor] * Valores[IntervaloHoras] * 3.6 ), Tags[Kpi] = "produccion" )',
     "Integra el caudal (l/s) de los tags KPI 'produccion': l/s × horas × 3,6 = m³."),
    ("4 Producción y energía", "Volumen entregado a red (m³)", "#,0",
     'CALCULATE ( SUMX ( Valores, Valores[Valor] * Valores[IntervaloHoras] * 3.6 ), Tags[Kpi] = "entrega_red" )', ""),
    ("4 Producción y energía", "Diferencia producción - entrega (m³)", "#,0",
     "[Volumen producido (m³)] - [Volumen entregado a red (m³)]",
     "Aproximación de pérdidas/uso interno entre producción y salida a red."),
    ("4 Producción y energía", "% diferencia producción - entrega", PCT,
     "DIVIDE ( [Diferencia producción - entrega (m³)], [Volumen producido (m³)] )", ""),
    ("4 Producción y energía", "Caudal producido promedio (l/s)", "#,0.0",
     'CALCULATE ( DIVIDE ( SUM ( Valores[Valor] ), DISTINCTCOUNT ( Valores[FechaHora] ) ), Tags[Kpi] = "produccion" )',
     "Suma de caudales de producción, promediada en el tiempo."),
    ("4 Producción y energía", "Energía (kWh)", "#,0",
     'CALCULATE ( SUMX ( Valores, Valores[Valor] * Valores[IntervaloHoras] ), Tags[Kpi] = "potencia" )',
     "Integra la potencia (kW) de los tags KPI 'potencia'."),
    ("4 Producción y energía", "Indicador energético (kWh/m³)", "0.000",
     "DIVIDE ( [Energía (kWh)], [Volumen producido (m³)] )", ""),
    ("4 Producción y energía", "Caudal mínimo nocturno (l/s)", "#,0.0",
     'MINX (\n    VALUES ( Calendario[Fecha] ),\n    CALCULATE ( AVERAGE ( Valores[Valor] ), Tags[Kpi] = "entrega_red", Valores[Hora] >= 2, Valores[Hora] < 5 )\n)',
     "Menor promedio diario de caudal a red entre 02:00 y 05:00 (indicador de fugas)."),

    ("5 Bombas y estanques", "Horas de marcha", "#,0.0",
     'CALCULATE ( SUMX ( Valores, Valores[Marcha] * Valores[IntervaloHoras] ), Tags[Kpi] = "bomba" )', ""),
    ("5 Bombas y estanques", "% tiempo en marcha", PCT,
     'DIVIDE ( [Horas de marcha], CALCULATE ( SUM ( Valores[IntervaloHoras] ), Tags[Kpi] = "bomba" ) )', ""),
    ("5 Bombas y estanques", "Nivel estanque promedio (%)", PCT,
     'CALCULATE (\n    AVERAGEX ( Valores, DIVIDE ( Valores[Valor] - RELATED ( Tags[Min] ), RELATED ( Tags[Max] ) - RELATED ( Tags[Min] ) ) ),\n    Tags[Kpi] = "nivel_estanque"\n)',
     "Nivel como % de la escala Min–Max del tag."),
    ("5 Bombas y estanques", "Nivel estanque mínimo (%)", PCT,
     'CALCULATE (\n    MINX ( Valores, DIVIDE ( Valores[Valor] - RELATED ( Tags[Min] ), RELATED ( Tags[Max] ) - RELATED ( Tags[Min] ) ) ),\n    Tags[Kpi] = "nivel_estanque"\n)', ""),
    ("5 Bombas y estanques", "Presión mínima (mca)", "#,0.0",
     'CALCULATE ( MIN ( Valores[Valor] ), Tags[Kpi] = "presion" )', ""),
    ("5 Bombas y estanques", "Presión promedio (mca)", "#,0.0",
     'CALCULATE ( AVERAGE ( Valores[Valor] ), Tags[Kpi] = "presion" )', ""),
]

# --------------------------------------------------------------- utilidades TMDL
def q(name):
    """Nombre TMDL: entre comillas simples si tiene caracteres especiales."""
    if name.replace("_", "").isalnum() and name.isascii():
        return name
    return "'" + name.replace("'", "''") + "'"


def fmt_val(fmt):
    return f'"{fmt}"' if ":" in fmt else fmt


def indent(text, tabs):
    pad = "\t" * tabs
    return "\n".join(pad + line if line.strip() else "" for line in text.split("\n"))


def write(rel, content, crlf=True):
    path = os.path.join(BASE, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if crlf:
        content = content.replace("\r\n", "\n").replace("\n", "\r\n")
    with open(path, "w", encoding="utf-8", newline="") as f:  # UTF-8 sin BOM
        f.write(content)


def table_tmdl(name, spec):
    out = [f"table {q(name)}", ""]
    if name == "Valores":
        for folder, mname, fmt, expr, desc in MEASURES:
            if desc:
                out.append(f"\t/// {desc}")
            if "\n" in expr:
                out.append(f"\tmeasure {q(mname)} =")
                out.append(indent(expr, 3))
            else:
                out.append(f"\tmeasure {q(mname)} = {expr}")
            out.append(f"\t\tformatString: {fmt_val(fmt)}")
            out.append(f"\t\tdisplayFolder: {folder}")
            out.append("")
    for col, dtype, fmt, extra in spec["columns"]:
        out.append(f"\tcolumn {q(col)}")
        out.append(f"\t\tdataType: {dtype}")
        if fmt:
            out.append(f"\t\tformatString: {fmt_val(fmt)}")
        if extra.get("isHidden"):
            out.append("\t\tisHidden")
        out.append("\t\tsummarizeBy: none")
        out.append(f"\t\tsourceColumn: {col}")
        if extra.get("sortByColumn"):
            out.append(f"\t\tsortByColumn: {q(extra['sortByColumn'])}")
        out.append("")
    out.append(f"\tpartition {q(name)} = m")
    out.append("\t\tmode: import")
    out.append("\t\tsource =")
    out.append(indent(spec["m"], 4))
    out.append("")
    return "\n".join(out)


# --------------------------------------------------------------- reporte (PBIR-Legacy)
_vid = 0


def field(entity, prop, kind="Column"):
    return {"entity": entity, "prop": prop, "kind": kind}


def M(prop):
    return field("Valores", prop, "Measure")


def visual(vtype, x, y, w, h, roles, title=None, extra_objects=None):
    """roles: {"Category": [field...], "Y": [...], ...}"""
    global _vid
    _vid += 1
    name = f"v{_vid:03d}"
    aliases, from_, select, projections = {}, [], [], {}
    for role, fields in roles.items():
        projections[role] = []
        for f in fields:
            ent = f["entity"]
            if ent not in aliases:
                aliases[ent] = f"{ent[0].lower()}{len(aliases)}"
                from_.append({"Name": aliases[ent], "Entity": ent, "Type": 0})
            ref = f"{ent}.{f['prop']}"
            projections[role].append({"queryRef": ref})
            if not any(s["Name"] == ref for s in select):
                select.append({
                    f["kind"]: {"Expression": {"SourceRef": {"Source": aliases[ent]}}, "Property": f["prop"]},
                    "Name": ref,
                })
    sv = {
        "visualType": vtype,
        "projections": projections,
        "prototypeQuery": {"Version": 2, "From": from_, "Select": select},
        "drillFilterOtherVisuals": True,
    }
    objs = dict(extra_objects or {})
    if title:
        sv["vcObjects"] = {"title": [{"properties": {
            "show": {"expr": {"Literal": {"Value": "true"}}},
            "text": {"expr": {"Literal": {"Value": "'" + title.replace("'", "''") + "'"}}},
        }}]}
    if objs:
        sv["objects"] = objs
    cfg = {
        "name": name,
        "layouts": [{"id": 0, "position": {"x": x, "y": y, "z": _vid, "width": w, "height": h}}],
        "singleVisual": sv,
    }
    return {"x": x, "y": y, "z": _vid, "width": w, "height": h,
            "config": json.dumps(cfg, ensure_ascii=False), "filters": "[]"}


def textbox(x, y, w, h, text, size="14pt"):
    global _vid
    _vid += 1
    cfg = {
        "name": f"v{_vid:03d}",
        "layouts": [{"id": 0, "position": {"x": x, "y": y, "z": _vid, "width": w, "height": h}}],
        "singleVisual": {"visualType": "textbox", "drillFilterOtherVisuals": True, "objects": {"general": [{"properties": {
            "paragraphs": [{"textRuns": [{"value": text, "textStyle": {"fontWeight": "bold", "fontSize": size}}]}]
        }}]}},
    }
    return {"x": x, "y": y, "z": _vid, "width": w, "height": h,
            "config": json.dumps(cfg, ensure_ascii=False), "filters": "[]"}


def date_slicer(x, y, w=300, h=80):
    return visual("slicer", x, y, w, h, {"Values": [field("Calendario", "Fecha")]}, "Periodo", {
        "data": [{"properties": {"mode": {"expr": {"Literal": {"Value": "'Between'"}}}}}]})


def cards(y, measures, x0=20, total_w=1240, h=110):
    gap = 10
    w = (total_w - gap * (len(measures) - 1)) / len(measures)
    return [visual("card", round(x0 + i * (w + gap)), y, round(w), h, {"Values": [M(m)]}, m)
            for i, m in enumerate(measures)]


def pages():
    fecha, nombre, area = field("Calendario", "Fecha"), field("Tags", "Nombre"), field("Tags", "Area")
    resumen = [
        textbox(20, 10, 700, 50, "Sistema de Agua Potable · Resumen", "20pt"),
        date_slicer(960, 5),
        *cards(100, ["Volumen producido (m³)", "Volumen entregado a red (m³)", "Energía (kWh)",
                     "Indicador energético (kWh/m³)", "% cumplimiento cloro", "% cumplimiento turbiedad"]),
        visual("clusteredColumnChart", 20, 225, 615, 240,
               {"Category": [fecha], "Y": [M("Volumen producido (m³)"), M("Volumen entregado a red (m³)")]},
               "Volumen diario (m³)"),
        visual("lineChart", 645, 225, 615, 240, {"Category": [fecha], "Y": [M("Indicador energético (kWh/m³)")]},
               "Indicador energético diario (kWh/m³)"),
        visual("lineChart", 20, 475, 615, 235,
               {"Category": [fecha], "Y": [M("Cloro libre mínimo (mg/l)"), M("Cloro libre promedio (mg/l)")]},
               "Cloro libre residual diario (mg/l)"),
        visual("tableEx", 645, 475, 615, 235,
               {"Values": [area, nombre, M("Horas en alarma"), M("Horas en alarma crítica"), M("% cumplimiento")]},
               "Alarmas por tag"),
    ]
    tendencias = [
        textbox(20, 10, 500, 50, "Tendencias por tag", "20pt"),
        visual("slicer", 20, 70, 260, 300, {"Values": [area]}, "Área"),
        visual("slicer", 20, 380, 260, 330, {"Values": [nombre]}, "Tag"),
        date_slicer(960, 5),
        visual("lineChart", 290, 90, 970, 330,
               {"Category": [field("Valores", "FechaHora")], "Y": [M("Valor promedio")], "Series": [nombre]},
               "Tendencia (seleccione tags a la izquierda)"),
        visual("tableEx", 290, 430, 970, 280,
               {"Values": [area, nombre, field("Tags", "Unidad"), M("Valor mínimo"), M("Valor promedio"),
                           M("Valor máximo"), M("Último valor"), M("% tiempo en alarma"), M("% cumplimiento")]},
               "Estadísticas del periodo"),
    ]
    calidad = [
        textbox(20, 10, 700, 50, "Calidad del agua · NCh409/1", "20pt"),
        date_slicer(960, 5),
        *cards(100, ["% cumplimiento cloro", "Cloro libre mínimo (mg/l)", "% cumplimiento turbiedad",
                     "Turbiedad máxima (NTU)", "% cumplimiento pH"]),
        visual("lineChart", 20, 225, 1240, 240,
               {"Category": [fecha], "Y": [M("Cloro libre promedio (mg/l)"), M("Cloro libre mínimo (mg/l)")]},
               "Cloro libre residual por día (norma 0,2 – 2,0 mg/l)"),
        visual("clusteredColumnChart", 20, 475, 615, 235,
               {"Category": [fecha], "Y": [M("% cumplimiento cloro"), M("% cumplimiento turbiedad")]},
               "% cumplimiento diario"),
        visual("lineChart", 645, 475, 615, 235, {"Category": [fecha], "Y": [M("Turbiedad máxima (NTU)")]},
               "Turbiedad máxima diaria agua tratada (NTU)"),
    ]
    produccion = [
        textbox(20, 10, 700, 50, "Producción, entrega y energía", "20pt"),
        date_slicer(960, 5),
        *cards(100, ["Volumen producido (m³)", "Diferencia producción - entrega (m³)",
                     "% diferencia producción - entrega", "Caudal mínimo nocturno (l/s)", "Indicador energético (kWh/m³)"]),
        visual("lineChart", 20, 225, 615, 240, {"Category": [fecha], "Y": [M("Caudal mínimo nocturno (l/s)")]},
               "Caudal mínimo nocturno 02–05 h (fugas)"),
        visual("clusteredColumnChart", 645, 225, 615, 240, {"Category": [fecha], "Y": [M("Energía (kWh)")]},
               "Energía diaria (kWh)"),
        visual("tableEx", 20, 475, 1240, 235,
               {"Values": [fecha, M("Volumen producido (m³)"), M("Volumen entregado a red (m³)"),
                           M("% diferencia producción - entrega"), M("Energía (kWh)"),
                           M("Indicador energético (kWh/m³)"), M("Caudal mínimo nocturno (l/s)")]},
               "Detalle diario"),
    ]
    bombas = [
        textbox(20, 10, 700, 50, "Bombas, estanques y presiones", "20pt"),
        date_slicer(960, 5),
        *cards(100, ["Horas de marcha", "% tiempo en marcha", "Nivel estanque promedio (%)",
                     "Nivel estanque mínimo (%)", "Presión mínima (mca)"]),
        visual("clusteredColumnChart", 20, 225, 615, 240, {"Category": [nombre], "Y": [M("Horas de marcha")]},
               "Horas de marcha por bomba"),
        visual("lineChart", 645, 225, 615, 240,
               {"Category": [fecha], "Y": [M("Nivel estanque mínimo (%)")], "Series": [nombre]},
               "Nivel mínimo diario por estanque (%)"),
        visual("lineChart", 20, 475, 1240, 235,
               {"Category": [fecha], "Y": [M("Presión mínima (mca)")], "Series": [nombre]},
               "Presión mínima diaria por sector (mca)"),
    ]
    return [("Resumen", resumen), ("Tendencias", tendencias), ("Calidad del agua", calidad),
            ("Producción y energía", produccion), ("Bombas y estanques", bombas)]


def report_json():
    sections = []
    for i, (title, visuals) in enumerate(pages()):
        sections.append({
            "config": "{}",
            "displayName": title,
            "displayOption": 1,
            "filters": "[]",
            "height": 720.0,
            "name": f"ReportSection{i}",
            "ordinal": i,
            "visualContainers": visuals,
            "width": 1280.0,
        })
    return {
        "config": json.dumps({"version": "5.43", "themeCollection": {}, "activeSectionIndex": 0,
                              "defaultDrillFilterOtherVisuals": True, "linguisticSchemaSyncVersion": 0}),
        "layoutOptimization": 0,
        "resourcePackages": [],
        "sections": sections,
    }


# --------------------------------------------------------------- generación
def main():
    for d in (SM, RP):
        shutil.rmtree(os.path.join(BASE, d), ignore_errors=True)

    write(f"{NAME}.pbip", json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json",
        "version": "1.0",
        "artifacts": [{"report": {"path": RP}}],
        "settings": {"enableAutoRecovery": True},
    }, indent=2))

    # ---- modelo semántico
    write(f"{SM}/definition.pbism", json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json",
        "version": "4.0",
        "settings": {},
    }, indent=2))
    write(f"{SM}/definition/database.tmdl", "database\n\tcompatibilityLevel: 1567\n")
    write(f"{SM}/definition/model.tmdl",
          "model Model\n\tculture: es-ES\n\tdefaultPowerBIDataSourceVersion: powerBI_V3\n\tsourceQueryCulture: es-CL\n\n"
          + "".join(f"ref table {q(t)}\n" for t in TABLES))
    expr = []
    for name, value, typ, desc in PARAMS:
        expr.append(f"/// {desc}")
        expr.append(f'expression {name} = {value} meta [IsParameterQuery = true, Type = "{typ}", IsParameterQueryRequired = true]')
        expr.append(f"\tannotation PBI_ResultType = {typ}")
        expr.append("")
    write(f"{SM}/definition/expressions.tmdl", "\n".join(expr))
    rel = []
    for rname, ft, fc, tt, tc in RELATIONSHIPS:
        rel += [f"relationship {rname}", f"\tfromColumn: {q(ft)}.{q(fc)}", f"\ttoColumn: {q(tt)}.{q(tc)}", ""]
    write(f"{SM}/definition/relationships.tmdl", "\n".join(rel))
    for tname, spec in TABLES.items():
        write(f"{SM}/definition/tables/{tname}.tmdl", table_tmdl(tname, spec))

    # ---- reporte
    write(f"{RP}/definition.pbir", json.dumps({
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json",
        "version": "4.0",
        "datasetReference": {"byPath": {"path": f"../{SM}"}},
    }, indent=2))
    write(f"{RP}/report.json", json.dumps(report_json(), indent=2, ensure_ascii=False))

    write(".gitignore", "**/.pbi/localSettings.json\n**/.pbi/cache.abf\n")

    # ---- archivos para armado manual
    pq = ["# Consultas Power Query (copiar y pegar)", "",
          "Para cada bloque: **Inicio → Obtener datos → Consulta en blanco → Editor avanzado**, pegue el código "
          "y cambie el nombre de la consulta por el título indicado.", "",
          "## Parámetros", "",
          "Créelos en **Inicio → Administrar parámetros → Nuevo parámetro** (requerido, sin valores sugeridos):", "",
          "| Nombre | Tipo | Valor actual | Para qué |", "|---|---|---|---|"]
    for name, value, typ, desc in PARAMS:
        pq.append(f"| `{name}` | {'Texto' if typ == 'Text' else 'Número decimal'} | `{value.strip(chr(34))}` | {desc} |")
    for tname, spec in TABLES.items():
        pq += ["", f"## Consulta `{tname}`", "", "```powerquery", spec["m"], "```"]
    write("manual/consultas-power-query.md", "\n".join(pq) + "\n", crlf=False)

    dax = ["# Medidas DAX (copiar y pegar)", "",
           "Seleccione la tabla **Valores** → **Herramientas de tabla → Nueva medida**, pegue cada bloque completo "
           "(nombre = fórmula) y asigne el formato indicado.", ""]
    folder = None
    for f, mname, fmt, expr_, desc in MEASURES:
        if f != folder:
            folder = f
            dax += [f"## {f[2:]}", ""]
        dax += [f"**{mname}** — formato `{fmt}`" + (f"  \n_{desc}_" if desc else ""), "", "```dax",
                f"{mname} =" + ("\n" + expr_ if "\n" in expr_ else " " + expr_), "```", ""]
    write("manual/medidas-dax.md", "\n".join(dax), crlf=False)
    print("Proyecto Power BI generado en", BASE)


if __name__ == "__main__":
    main()
