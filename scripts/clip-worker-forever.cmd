@echo off
rem === ViralFlow Clip Worker (เลี้ยงให้ไม่ตาย) — restart อัตโนมัติเมื่อ process ออก/แครช ===
rem ใช้แทน "node scripts\clip-worker.mjs" ตรงๆ เพื่อกัน worker ตายแล้วงานคิวค้าง
chcp 65001 >nul
rem ★ 28 มิ.ย.: chcp 65001 = UTF-8 → ภาษาไทยใน log ไม่เพี้ยน (เดิมไม่มี = อ่านไม่ออก)
set PATH=C:\Program Files\nodejs;%PATH%
cd /d C:\Users\User\227-5-~1.16
:loop
echo [forever] starting clip-worker %date% %time%
node scripts\clip-worker.mjs
echo [forever] clip-worker exited — restart ใน 5 วิ...
timeout /t 5 /nobreak >nul
goto loop
