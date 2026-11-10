<#
  Puente PI SDK -> JSON para el tablero.

  Usa el PI SDK (COM "PISDK.PISDK") que se instala junto con PI ProcessBook,
  por lo que NO requiere PI Web API. Debe ejecutarse en un PC Windows donde
  ProcessBook ya se conecta al servidor PI.

  Protocolo: el servidor Node envía una petición JSON por línea en stdin y
  recibe una respuesta JSON por línea en stdout.
    {"id":1,"op":"current","paths":["\\PISRV01\TAG1","\\PISRV01\TAG2"]}
    {"id":2,"op":"history","path":"\\PISRV01\TAG1","start":"*-8h","interval":"5m","count":97}

  Prueba manual (desde PowerShell de 32 bits, igual que ProcessBook):
    C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass `
      -File server\pisdk-bridge.ps1 -Test "\\PISRV01\SINUSOID" "\\PISRV01\CDT158"
#>
param(
  [switch]$Test,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths
)
# Conexión opcional, p.ej. "UID=lector;PWD=xxx". Vacío = misma conexión que ProcessBook (trust / usuario por defecto)
$Connect = $env:PISDK_CONNECT

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Write-Json($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

try {
  $sdk = New-Object -ComObject PISDK.PISDK
} catch {
  $bits = if ([Environment]::Is64BitProcess) { '64' } else { '32' }
  Write-Json @{ ready = $false; error = "No se pudo cargar PI SDK (PowerShell de $bits bits): $($_.Exception.Message). Use la PowerShell de 32 bits (SysWOW64) o instale PI SDK." }
  exit 1
}

$servers = @{}
$points = @{}

function Get-PiServer([string]$name) {
  if ($servers.ContainsKey($name)) {
    $srv = $servers[$name]
  } else {
    if ($name) { $srv = $sdk.Servers.Item($name) } else { $srv = $sdk.Servers.DefaultServer }
    $servers[$name] = $srv
  }
  if (-not $srv.Connected) {
    if ($Connect) { $srv.Open($Connect) } else { $srv.Open() }
  }
  return $srv
}

# "\\SERVIDOR\TAG" -> ("SERVIDOR","TAG");  "TAG" -> ("", "TAG") usa el servidor por defecto
function Split-PiPath([string]$path) {
  if ($path -match '^\\\\([^\\]+)\\(.+)$') { return @($Matches[1], $Matches[2]) }
  return @('', $path)
}

function Get-PiPoint([string]$path) {
  if ($points.ContainsKey($path)) { return $points[$path] }
  $parts = Split-PiPath $path
  $pt = (Get-PiServer $parts[0]).PIPoints.Item($parts[1])
  $points[$path] = $pt
  return $pt
}

# PIValue -> @{ v; t (ms epoch UTC); good; digital }
function Convert-PiValue($pv) {
  $v = $pv.Value
  $digital = $false
  if ($v -is [System.__ComObject]) {
    # Estado digital (Marcha/Detenida) o estado de sistema (I/O Timeout, Shutdown...)
    $digital = $true
    $v = [string]$v.Name
  } elseif ($v -is [single] -or $v -is [double] -or $v -is [int] -or $v -is [int16] -or $v -is [long]) {
    $v = [double]$v
  } else {
    $v = [string]$v
  }
  $good = $true
  try { $good = [bool]$pv.IsGood() } catch { }
  return @{ v = $v; t = [double]$pv.TimeStamp.UTCSeconds * 1000; good = $good; digital = $digital }
}

function Invoke-Request($req) {
  switch ($req.op) {
    'ping' { return @{ pong = $true } }

    'current' {
      $items = New-Object System.Collections.ArrayList
      foreach ($path in $req.paths) {
        try {
          [void]$items.Add((Convert-PiValue (Get-PiPoint $path).Data.Snapshot))
        } catch {
          $points.Remove($path)
          [void]$items.Add(@{ error = $_.Exception.Message })
        }
      }
      return @{ items = $items }
    }

    'history' {
      $data = (Get-PiPoint $req.path).Data
      # RecordedValues(inicio, fin, boundaryType): boundaryType 2 = interpolado en
      # los bordes. Es la MISMA llamada que usa la macro de turno y que funciona
      # con este PI SDK (evita las firmas problemáticas de InterpolatedValues).
      try {
        $vals = $data.RecordedValues($req.start, '*', 2)
      } catch {
        # Fallback: interpolado por paso de tiempo, si RecordedValues no está.
        $vals = $data.InterpolatedValues($req.start, '*', $req.interval)
      }
      $out = New-Object System.Collections.ArrayList
      foreach ($pv in $vals) {
        $c = Convert-PiValue $pv
        if ($c.good) { [void]$out.Add(@{ t = $c.t; v = $c.v }) }
      }
      return @{ points = $out }
    }

    default { throw "Operación desconocida: $($req.op)" }
  }
}

# ---------------------------------------------------------------- prueba manual
if ($Test) {
  foreach ($path in $Paths) {
    try {
      $c = Convert-PiValue (Get-PiPoint $path).Data.Snapshot
      $ts = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$c.t).LocalDateTime
      Write-Host ("OK    {0} = {1}  ({2:yyyy-MM-dd HH:mm:ss}, bueno={3})" -f $path, $c.v, $ts, $c.good)
    } catch {
      Write-Host ("ERROR {0}: {1}" -f $path, $_.Exception.Message)
    }
  }
  exit 0
}

# ---------------------------------------------------------------- bucle principal
$sdkVersion = '?'
try { $sdkVersion = [string]$sdk.PISDKVersion.Version } catch { }
Write-Json @{ ready = $true; sdk = $sdkVersion; bits = $(if ([Environment]::Is64BitProcess) { 64 } else { 32 }) }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $id = $null
  try {
    $req = $line | ConvertFrom-Json
    $id = $req.id
    $res = Invoke-Request $req
    $res.ok = $true
  } catch {
    $res = @{ ok = $false; error = $_.Exception.Message }
  }
  $res.id = $id
  Write-Json $res
}
