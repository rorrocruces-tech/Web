@echo off
REM Envia UN SMS de prueba usando la configuracion del .env y muestra el resultado.
REM Funciona con Node.js instalado o con Node.js PORTATIL (sin administrador),
REM igual que iniciar.bat.
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
  echo  No se encontro Node.js. Use la misma carpeta de Node que usa iniciar.bat.
  echo.
  pause
  exit /b 1
)

echo Enviando SMS de prueba...
"%NODE%" server\probar-sms.js %1
echo.
pause
