@echo off
rem === Clip-Insight LIVE Monitor — หน้าต่างเฝ้าคิวถอดประเด็น เรียลไทม์ อ่านไทยได้ (28 มิ.ย.) ===
chcp 65001 >nul
title ถอดประเด็นจากคลิป - LIVE (เรียลไทม์)
cd /d "%~dp0.."
set PATH=C:\Program Files\nodejs;%PATH%
:loop
node scripts\clip-live-monitor.mjs
echo.
echo monitor หลุด - เปิดใหม่ใน 3 วิ...
timeout /t 3 /nobreak >nul
goto loop
