@echo off
chcp 65001 >nul
title Cover Monitor - LIVE
cd /d "%~dp0.."
set PATH=C:\Program Files\nodejs;%PATH%
:loop
node scripts\cover-live-monitor.mjs
echo.
echo monitor exited - restart in 3s
timeout /t 3 /nobreak >nul
goto loop
