' Inicia el tablero en segundo plano, SIN ventana visible.
' Pensado para el auto-arranque: ponga un acceso directo a este archivo en la
' carpeta de Inicio de Windows (Win+R -> shell:startup).
Dim fso, carpeta, sh
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = carpeta
' El 0 = ventana oculta; False = no esperar a que termine.
sh.Run "cmd /c """ & carpeta & "\tablero-servicio.bat""", 0, False
