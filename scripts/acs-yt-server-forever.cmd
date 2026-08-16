@echo off
setlocal enabledelayedexpansion
rem ACS YouTube job server keeper - port 3900 (6 Jul 2026)
rem เซิร์ฟเวอร์แยกเฉพาะงานแคปเฟรม YouTube — กัน pipeline หนักทำเซิร์ฟเวอร์ข่าว :3000 ตาย
rem (บทเรียน 6 ก.ค.: รัน pipeline ใน :3000 แล้ว server crash 2 รอบ 13:04/13:17)
set PATH=C:\Program Files\nodejs;%PATH%
rem ★ 15 ส.ค. 69 (เจ้าของสั่ง "ให้เป็นโค้ดใหม่ทั้งหมด"): ย้ายมาโฟลเดอร์ตาม main/Vercel
rem   เดิมชี้กลับ C:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16 — สคริปต์อยู่ npd แต่ cd กลับของเก่า
rem   = สตาร์ทจาก npd ก็ยังได้โค้ดเก่าเงียบๆ (กับดักเดียวกับที่ clip-worker เคยเจอ แก้ไปแล้ว 1e5f055)
cd /d "C:\news-pipeline-dev"
rem ★ 9 ก.ค.: :3900 ใช้ build แยกโฟลเดอร์ .next-3900 (ไม่ใช้ .next ร่วมกับ :3000)
rem   เพื่อ build โค้ดใหม่ (เช่น /api/quick-test) ให้ :3900 โดยไม่ต้องแตะ/รีสตาร์ทเซิร์ฟเวอร์ข่าว :3000
set NEXT_DISTDIR=.next-3900
rem ★ 16 ส.ค. 69 (เจ้าของสั่ง "ห้ามปลุกของเก่า" · ผู้ตรวจอิสระชี้ว่านี่คือรากของปัญหา):
rem   ของเดิมเช็คแค่ "มี .next-3900\BUILD_ID ไหม" → พอมีโค้ดใหม่ ไฟล์ยังอยู่ = ข้าม build
rem   ⇒ รีสตาร์ตกี่รอบก็ได้โค้ดเก่า (16 ส.ค. :3900 ตกหลัง main ถึง 12 คอมมิตเพราะเหตุนี้)
rem   → จำว่า "บิลด์นี้มาจากคอมมิตไหน" แล้วเทียบ HEAD ทุกครั้ง · ไม่ตรง = build ใหม่เอง
for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set "HEADSHA=%%i"
set "STAMP=.next-3900\.built-from-commit"
set "NEEDBUILD=0"
if not exist ".next-3900\BUILD_ID" set "NEEDBUILD=1"
if not exist "%STAMP%" set "NEEDBUILD=1"
if exist "%STAMP%" (
  set /p BUILTSHA=<"%STAMP%"
  if not "!BUILTSHA!"=="!HEADSHA!" (
    echo [acs-yt-server] build เก่ากว่าโค้ด ^(บิลด์จาก !BUILTSHA:~0,7! · HEAD !HEADSHA:~0,7!^) - build ใหม่ %date% %time% >> _acs_yt_server.log
    set "NEEDBUILD=1"
  )
)
if "!NEEDBUILD!"=="1" (
  echo [acs-yt-server] building .next-3900... %date% %time% >> _acs_yt_server.log
  call npm run build >> _acs_yt_server.log 2>&1
  if exist ".next-3900\BUILD_ID" ( >"%STAMP%" echo !HEADSHA! )
)
:loop
echo [forever] starting acs-yt-server :3900 %date% %time% >> _acs_yt_server.log
rem ★ 9 ก.ค.: --max-old-space-size=4096 (heap 4GB) — ท่อ ref โหลดภาพเป็นร้อยใบ+sharp = mem spike → :3900 OOM crash
rem   (เดิม npx next start เปล่าๆ heap default ~2GB · เทสข่าวจริง 13:35 crash กลางท่อ) · ให้ heap เท่า :3000
rem ★ 18 ก.ค.: --require crash-logger.cjs = ตามองเห็นการตาย (heartbeat แรม rss/external/arrayBuffers ลง _crash-3900.log) — วินิจฉัย :3900 ตายเงียบตอนขั้น search+YT
call node --max-old-space-size=4096 --require ./scripts/crash-logger.cjs node_modules\next\dist\bin\next start -p 3900 >> _acs_yt_server.log 2>&1
echo [forever] acs-yt-server exited - restart in 5s >> _acs_yt_server.log
rem ★ 9 ก.ค.: ใช้ ping แทน timeout — timeout ต้องมี console stdin, เมื่อ redirect log มันเด้ง error ทันที
rem   ทำให้ลูปหมุนเต็มสปีดกิน CPU (บั๊ก 7 ก.ค. 5:04 crash-loop รัวในวินาทีเดียว) · ping -n 6 = รอ ~5 วิ ไม่ง้อ stdin
ping -n 6 127.0.0.1 >nul
goto loop
