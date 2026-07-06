@echo off
rem ACS YouTube frame worker keeper - restart auto on crash (6 Jul 2026)
set PATH=C:\Program Files\nodejs;%PATH%
cd /d C:\Users\User\227-5-~1.16
:loop
echo [forever] starting acs-yt-worker %date% %time%
node scripts\acs-yt-worker.mjs
echo [forever] acs-yt-worker exited - restart in 5s
timeout /t 5 /nobreak >nul
goto loop
