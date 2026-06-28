@echo off
rem ViralFlow Clip Worker keeper - restart auto on crash
set PATH=C:\Program Files\nodejs;%PATH%
cd /d C:\Users\User\227-5-~1.16
:loop
echo [forever] starting clip-worker %date% %time%
node scripts\clip-worker.mjs
echo [forever] clip-worker exited - restart in 5s
timeout /t 5 /nobreak >nul
goto loop
