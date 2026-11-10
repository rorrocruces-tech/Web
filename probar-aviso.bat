@echo off
REM Envia los DOS avisos reales (DETENIDO y EN SERVICIO) de inmediato,
REM usando la configuracion del .env. Util para ver como llegan.
REM Uso opcional:  probar-aviso.bat "Molino SAG"  +56953718514
setlocal
cd /d "%~dp0"

set "NODE="
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
for /d %%D in ("%~dp0node-v*-win-*") do if exist "%%D\node.exe" set "NODE=%%D\node.exe"
if not defined NODE (
  where node >nul 2>nul && set "NODE=node"
)
if not defined NODE (
  echo  No se encontro Node.js. Use la misma carpeta de Node que usa iniciar.bat.
  pause
  exit /b 1
)

if exist "%~dp0empresa-ca.pem" set "NODE_EXTRA_CA_CERTS=%~dp0empresa-ca.pem"

if defined NODE_EXTRA_CA_CERTS echo (usando certificado de empresa: empresa-ca.pem)
"%NODE%" server\probar-aviso.js %1 %2
echo.
pause
