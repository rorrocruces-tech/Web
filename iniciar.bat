@echo off
REM Inicia el tablero en Windows. Requiere Node.js 18+ (https://nodejs.org).
REM La configuracion se toma del archivo .env (copie .env.example como .env).
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
echo Abriendo tablero en http://localhost:3000  (Ctrl+C para detener)
start "" http://localhost:3000
node server\server.js
pause
