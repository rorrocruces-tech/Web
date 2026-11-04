@echo off
REM Prueba la lectura de tags con el PI SDK de ProcessBook, sin iniciar el tablero.
REM Uso:  probar-pisdk.bat "\\PISRV01\TAG1" "\\PISRV01\TAG2"
cd /d "%~dp0"
set PS=%WINDIR%\SysWOW64\WindowsPowerShell\v1.0\powershell.exe
if not exist "%PS%" set PS=powershell.exe
if "%~1"=="" (
  echo Uso: probar-pisdk.bat "\\SERVIDOR_PI\TAG" ["\\SERVIDOR_PI\OTRO_TAG" ...]
  goto :eof
)
"%PS%" -NoProfile -ExecutionPolicy Bypass -File server\pisdk-bridge.ps1 -Test %*
pause
