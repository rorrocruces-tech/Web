@echo off
REM Arranca el servidor del tablero en segundo plano (sin navegador y sin
REM ventana de pausa). Pensado para el auto-arranque via iniciar-oculto.vbs.
REM Para ver el tablero, abra http://localhost:3000 en el navegador.
setlocal
cd /d "%~dp0"

set "NODE="
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
for /d %%D in ("%~dp0node-v*-win-*") do if exist "%%D\node.exe" set "NODE=%%D\node.exe"
if not defined NODE (
  where node >nul 2>nul && set "NODE=node"
)
if not defined NODE exit /b 1

if not exist .env copy .env.example .env >nul
if exist "%~dp0empresa-ca.pem" set "NODE_EXTRA_CA_CERTS=%~dp0empresa-ca.pem"

REM Reinicia el servidor si se cae (bucle), registrando la salida en tablero.log
:bucle
echo [%date% %time%] iniciando tablero >> "%~dp0tablero.log"
"%NODE%" server\server.js >> "%~dp0tablero.log" 2>&1
echo [%date% %time%] el tablero se detuvo; reintentando en 10 s >> "%~dp0tablero.log"
timeout /t 10 /nobreak >nul
goto bucle
