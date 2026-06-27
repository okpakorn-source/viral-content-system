@echo off
rem === ViralFlow PRODUCTION server + auto-restart (26 มิ.ย.) ===
rem   เหตุผล: npm run dev (turbopack) รันยาวแล้วป่วย — "Cannot find module @supabase" → worker route 500 → คิวตาย
rem   แก้: build production แล้ว loop npm start (เสถียร ไม่มีบั๊ก turbopack) + ถ้า crash รีสตาร์ทเอง
cd /d "%~dp0.."
set PATH=C:\Program Files\nodejs;%PATH%
rem build เฉพาะถ้ายังไม่มี (มี .next\BUILD_ID = build แล้ว ข้ามไป start เลย เร็ว) · เปลี่ยนโค้ดแล้วอยากให้ build ใหม่: ลบ .next ก่อน
if not exist ".next\BUILD_ID" (
  echo [server-forever] no build - building... %date% %time%
  call npm run build
)
:loop
echo [server-forever] start npm start... %date% %time%
rem ★ 27 มิ.ย.: เก็บ stdout ลง _prodserver.log (วินิจฉัยปก/คิว) — แต่ละรอบเขียนทับ (ดูรอบล่าสุดง่าย)
call npm start > "%~dp0..\_prodserver.log" 2>&1
echo [server-forever] server exited - restart in 5s
timeout /t 5 /nobreak >nul
goto loop
