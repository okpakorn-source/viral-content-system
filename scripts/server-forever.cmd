@echo off
rem === ViralFlow PRODUCTION server + auto-restart (26 มิ.ย.) ===
rem   เหตุผล: npm run dev (turbopack) รันยาวแล้วป่วย — "Cannot find module @supabase" → worker route 500 → คิวตาย
rem   แก้: build production แล้ว loop npm start (เสถียร ไม่มีบั๊ก turbopack) + ถ้า crash รีสตาร์ทเอง
setlocal enabledelayedexpansion
cd /d "%~dp0.."
set PATH=C:\Program Files\nodejs;%PATH%
rem ★ 16 ส.ค. 69 (เจ้าของสั่ง "ห้ามปลุกของเก่า" · ผู้ตรวจอิสระชี้ว่านี่คือรากของปัญหา):
rem   ของเดิมเช็คแค่ "มี .next\BUILD_ID ไหม" → พอ pull/commit โค้ดใหม่ ไฟล์ยังอยู่ = ข้าม build
rem   ⇒ รีสตาร์ตกี่รอบก็ได้โค้ดเก่าเงียบๆ (16 ส.ค. :3000 ตกหลัง main ถึง 5 คอมมิตเพราะเหตุนี้)
rem   → เปลี่ยนเป็นจำว่า "บิลด์นี้มาจากคอมมิตไหน" แล้วเทียบกับ HEAD ทุกครั้งที่ keeper เริ่ม
rem   ไม่ตรง = build ใหม่อัตโนมัติ · ตรง = ข้ามไป start เลย (เร็วเหมือนเดิม)
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "HEADSHA=%%i"
set "STAMP=.next\.built-from-commit"
set "NEEDBUILD=0"
if not exist ".next\BUILD_ID" set "NEEDBUILD=1"
if not exist "%STAMP%" set "NEEDBUILD=1"
if exist "%STAMP%" (
  set /p BUILTSHA=<"%STAMP%"
  if not "!BUILTSHA!"=="!HEADSHA!" (
    echo [server-forever] build เก่ากว่าโค้ด ^(บิลด์จาก !BUILTSHA:~0,7! · HEAD !HEADSHA:~0,7!^) - build ใหม่... %date% %time%
    set "NEEDBUILD=1"
  )
)
if "!NEEDBUILD!"=="1" (
  echo [server-forever] building .next ... %date% %time%
  call npm run build
  if exist ".next\BUILD_ID" ( >"%STAMP%" echo !HEADSHA! )
)
:loop
echo [server-forever] start cover-server (heap 4GB)... %date% %time%
rem ★ 27 มิ.ย.: เก็บ stdout ลง _prodserver.log (วินิจฉัยปก/คิว) — แต่ละรอบเขียนทับ (ดูรอบล่าสุดง่าย)
rem ★ 10 ก.ค.: npm start (heap default ~2GB) OOM ตายกลางท่อปกใหม่ (PNG intermediates+enhance กินแรมขึ้น)
rem   → ใช้ cover-server (--max-old-space-size=4096) ที่มีไว้เพื่องานปกอยู่แล้ว
call npm run cover-server > "%~dp0..\_prodserver.log" 2>&1
echo [server-forever] server exited - restart in 5s
timeout /t 5 /nobreak >nul
goto loop
