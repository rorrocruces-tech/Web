@echo off
REM Inicia el tablero en Windows.
REM Funciona con Node.js instalado o con Node.js PORTATIL (sin permisos de administrador):
REM descomprima el .zip de Node.js dentro de esta carpeta (queda una carpeta node-v...-win-x64 o "node").
REM La configuracion se toma del archivo .env (se crea desde .env.example la primera vez).
setlocal
cd /d "%~dp0"

set "NODE="
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
for /d %%D in ("%~dp0node-v*-win-*") do if exist "%%D\node.exe" set "NODE=%%D\node.exe"
if not defined NODE (
  where node >nul 2>nul && set "NODE=node"
)
if not defined NODE (
  echo.
  echo  No se encontro Node.js.
  echo  Sin permisos de administrador: descargue "Windows Binary (.zip)" desde https://nodejs.org/en/download
  echo  y descomprimalo DENTRO de esta carpeta: %~dp0
  echo.
  pause
  exit /b 1
)

if not exist .env copy .env.example .env >nul

REM Si la red de la empresa intercepta HTTPS, coloque el certificado raiz
REM corporativo como "empresa-ca.pem" en esta carpeta; Node confiara en el
REM (necesario para que los avisos SMS salgan por Twilio/httpSMS).
if exist "%~dp0empresa-ca.pem" set "NODE_EXTRA_CA_CERTS=%~dp0empresa-ca.pem"

echo Usando Node.js: %NODE%
if defined NODE_EXTRA_CA_CERTS echo Certificado de empresa: empresa-ca.pem
echo Abriendo tablero en http://localhost:3000  (cierre esta ventana para detenerlo)
start "" http://localhost:3000
"%NODE%" server\server.js
pause
