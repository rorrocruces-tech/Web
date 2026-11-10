@echo off
REM Detiene el tablero que corre en segundo plano.
REM Cierra el bucle de arranque y el proceso de Node.
setlocal
echo Deteniendo el tablero...

REM Cierra la ventana oculta del servicio (cmd que ejecuta tablero-servicio.bat)
for /f "tokens=2 delims==; " %%P in ('wmic process where "name='cmd.exe' and commandline like '%%tablero-servicio.bat%%'" get processid /value 2^>nul ^| find "ProcessId"') do taskkill /f /pid %%P >nul 2>&1

REM Cierra el proceso de Node del servidor
taskkill /f /im node.exe >nul 2>&1

echo Tablero detenido.
echo (Si lo tiene en auto-arranque, volvera a iniciarse al reiniciar o iniciar sesion.)
pause
