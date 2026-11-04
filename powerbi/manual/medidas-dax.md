# Medidas DAX (copiar y pegar)

Seleccione la tabla **Valores** → **Herramientas de tabla → Nueva medida**, pegue cada bloque completo (nombre = fórmula) y asigne el formato indicado.

## Básicas

**Valor promedio** — formato `#,0.00`  
_Promedio de los valores del tag/periodo filtrado._

```dax
Valor promedio = AVERAGE ( Valores[Valor] )
```

**Valor mínimo** — formato `#,0.00`

```dax
Valor mínimo = MIN ( Valores[Valor] )
```

**Valor máximo** — formato `#,0.00`

```dax
Valor máximo = MAX ( Valores[Valor] )
```

**Último valor** — formato `#,0.00`  
_Valor en la última fecha/hora disponible del filtro._

```dax
Último valor =
VAR ultimo = CALCULATE ( MAX ( Valores[FechaHora] ), NOT ISBLANK ( Valores[Valor] ) )
RETURN CALCULATE ( AVERAGE ( Valores[Valor] ), Valores[FechaHora] = ultimo )
```

**Muestras** — formato `#,0`

```dax
Muestras = COUNTROWS ( Valores )
```

## Alarmas

**Horas en alarma** — formato `#,0.0`  
_Horas con el valor fuera de algún límite (L, H, LL, HH o falla)._

```dax
Horas en alarma = CALCULATE ( SUM ( Valores[IntervaloHoras] ), NOT ISBLANK ( Valores[Alarma] ) )
```

**Horas en alarma crítica** — formato `#,0.0`  
_Horas fuera de los límites críticos LL/HH o con falla._

```dax
Horas en alarma crítica = CALCULATE ( SUM ( Valores[IntervaloHoras] ), Valores[Alarma] IN { "LL", "HH", "DIG" } )
```

**% tiempo en alarma** — formato `0.0%`

```dax
% tiempo en alarma = DIVIDE ( [Horas en alarma], SUM ( Valores[IntervaloHoras] ) )
```

**% cumplimiento** — formato `0.0%`  
_% del tiempo dentro de los límites críticos LL/HH._

```dax
% cumplimiento = 1 - DIVIDE ( [Horas en alarma crítica], CALCULATE ( SUM ( Valores[IntervaloHoras] ), NOT ISBLANK ( Valores[Valor] ) ) )
```

## Calidad agua (NCh409)

**Cloro libre promedio (mg/l)** — formato `0.00`

```dax
Cloro libre promedio (mg/l) = CALCULATE ( AVERAGE ( Valores[Valor] ), Tags[Kpi] = "cloro" )
```

**Cloro libre mínimo (mg/l)** — formato `0.00`

```dax
Cloro libre mínimo (mg/l) = CALCULATE ( MIN ( Valores[Valor] ), Tags[Kpi] = "cloro" )
```

**% cumplimiento cloro** — formato `0.0%`  
_% del tiempo con cloro libre entre los límites LL y HH del tag (NCh409/1: 0,2 – 2,0 mg/l)._

```dax
% cumplimiento cloro = CALCULATE ( [% cumplimiento], Tags[Kpi] = "cloro" )
```

**Turbiedad máxima (NTU)** — formato `0.00`

```dax
Turbiedad máxima (NTU) = CALCULATE ( MAX ( Valores[Valor] ), Tags[Kpi] = "turbiedad" )
```

**% cumplimiento turbiedad** — formato `0.0%`  
_% del tiempo con turbiedad bajo el límite HH del tag (NCh409/1: 2 NTU)._

```dax
% cumplimiento turbiedad = CALCULATE ( [% cumplimiento], Tags[Kpi] = "turbiedad" )
```

**% cumplimiento pH** — formato `0.0%`

```dax
% cumplimiento pH = CALCULATE ( [% cumplimiento], Tags[Kpi] = "ph" )
```

## Producción y energía

**Volumen producido (m³)** — formato `#,0`  
_Integra el caudal (l/s) de los tags KPI 'produccion': l/s × horas × 3,6 = m³._

```dax
Volumen producido (m³) = CALCULATE ( SUMX ( Valores, Valores[Valor] * Valores[IntervaloHoras] * 3.6 ), Tags[Kpi] = "produccion" )
```

**Volumen entregado a red (m³)** — formato `#,0`

```dax
Volumen entregado a red (m³) = CALCULATE ( SUMX ( Valores, Valores[Valor] * Valores[IntervaloHoras] * 3.6 ), Tags[Kpi] = "entrega_red" )
```

**Diferencia producción - entrega (m³)** — formato `#,0`  
_Aproximación de pérdidas/uso interno entre producción y salida a red._

```dax
Diferencia producción - entrega (m³) = [Volumen producido (m³)] - [Volumen entregado a red (m³)]
```

**% diferencia producción - entrega** — formato `0.0%`

```dax
% diferencia producción - entrega = DIVIDE ( [Diferencia producción - entrega (m³)], [Volumen producido (m³)] )
```

**Caudal producido promedio (l/s)** — formato `#,0.0`  
_Suma de caudales de producción, promediada en el tiempo._

```dax
Caudal producido promedio (l/s) = CALCULATE ( DIVIDE ( SUM ( Valores[Valor] ), DISTINCTCOUNT ( Valores[FechaHora] ) ), Tags[Kpi] = "produccion" )
```

**Energía (kWh)** — formato `#,0`  
_Integra la potencia (kW) de los tags KPI 'potencia'._

```dax
Energía (kWh) = CALCULATE ( SUMX ( Valores, Valores[Valor] * Valores[IntervaloHoras] ), Tags[Kpi] = "potencia" )
```

**Indicador energético (kWh/m³)** — formato `0.000`

```dax
Indicador energético (kWh/m³) = DIVIDE ( [Energía (kWh)], [Volumen producido (m³)] )
```

**Caudal mínimo nocturno (l/s)** — formato `#,0.0`  
_Menor promedio diario de caudal a red entre 02:00 y 05:00 (indicador de fugas)._

```dax
Caudal mínimo nocturno (l/s) =
MINX (
    VALUES ( Calendario[Fecha] ),
    CALCULATE ( AVERAGE ( Valores[Valor] ), Tags[Kpi] = "entrega_red", Valores[Hora] >= 2, Valores[Hora] < 5 )
)
```

## Bombas y estanques

**Horas de marcha** — formato `#,0.0`

```dax
Horas de marcha = CALCULATE ( SUMX ( Valores, Valores[Marcha] * Valores[IntervaloHoras] ), Tags[Kpi] = "bomba" )
```

**% tiempo en marcha** — formato `0.0%`

```dax
% tiempo en marcha = DIVIDE ( [Horas de marcha], CALCULATE ( SUM ( Valores[IntervaloHoras] ), Tags[Kpi] = "bomba" ) )
```

**Nivel estanque promedio (%)** — formato `0.0%`  
_Nivel como % de la escala Min–Max del tag._

```dax
Nivel estanque promedio (%) =
CALCULATE (
    AVERAGEX ( Valores, DIVIDE ( Valores[Valor] - RELATED ( Tags[Min] ), RELATED ( Tags[Max] ) - RELATED ( Tags[Min] ) ) ),
    Tags[Kpi] = "nivel_estanque"
)
```

**Nivel estanque mínimo (%)** — formato `0.0%`

```dax
Nivel estanque mínimo (%) =
CALCULATE (
    MINX ( Valores, DIVIDE ( Valores[Valor] - RELATED ( Tags[Min] ), RELATED ( Tags[Max] ) - RELATED ( Tags[Min] ) ) ),
    Tags[Kpi] = "nivel_estanque"
)
```

**Presión mínima (mca)** — formato `#,0.0`

```dax
Presión mínima (mca) = CALCULATE ( MIN ( Valores[Valor] ), Tags[Kpi] = "presion" )
```

**Presión promedio (mca)** — formato `#,0.0`

```dax
Presión promedio (mca) = CALCULATE ( AVERAGE ( Valores[Valor] ), Tags[Kpi] = "presion" )
```
