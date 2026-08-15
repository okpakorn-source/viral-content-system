@echo off
chcp 65001 >nul
REM ============================================================
REM  clip-sync-restart (14 ส.ค. 69 — เจ้าของสั่ง "build + restart ทั้งพอร์ตและ worker")
REM  ทำครบในคลิกเดียว: ดึงโค้ด main ล่าสุด → npm install → next build
REM  → ปิด/เปิดพอร์ต 3000 + clip-worker ใหม่
REM  วิธีใช้ (เปิด cmd ที่โฟลเดอร์โปรเจกต์): scripts\clip-sync-restart.cmd
REM ============================================================
cd /d "%~dp0.."

echo [1/5] ดึงโค้ดล่าสุดจาก main ...
git pull origin main
if errorlevel 1 (echo ❌ git pull ล้ม — เช็คไฟล์แก้ค้าง/อินเทอร์เน็ต แล้วรันใหม่ & pause & exit /b 1)
for /f %%h in ('git rev-parse --short HEAD') do echo     ✔ ตอนนี้อยู่ที่คอมมิต %%h

echo [2/5] ติดตั้ง dependencies ...
call npm install --no-audit --no-fund

echo [3/6] next build (.next สำหรับ :3000) ...
call npx next build
if errorlevel 1 (echo ❌ build ล้ม — ดู error ด้านบน & pause & exit /b 1)

echo [4/6] next build (.next-3900 สำหรับ :3900 — บ้านงานหนักถอดคลิป ตั้งแต่ 15 ส.ค. 69) ...
set NEXT_DISTDIR=.next-3900
call npx next build
if errorlevel 1 (echo ❌ build .next-3900 ล้ม — ดู error ด้านบน & pause & exit /b 1)
set NEXT_DISTDIR=

echo [5/6] ปิดโปรเซสเดิม :3000 + :3900 (ตัว forever ของ 3900 จะเปิดคืนเองบน build ใหม่) ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3900 " ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1

echo [6/6] เปิดใหม่: dev server (3000 — ข่าว/UI) + :3900 keeper (ถ้ายังไม่มี) + clip-worker (ชี้ :3900) ...
start "clip-dev-3000" cmd /k npm run dev
tasklist /fi "windowtitle eq ACS YT Server 3900*" 2>nul | findstr cmd.exe >nul || start "ACS YT Server 3900" /min cmd /k scripts\acs-yt-server-forever.cmd
start "clip-worker" cmd /k "set CLIP_WORKER_BASE=http://localhost:3900&& node scripts\clip-worker.mjs"

echo.
echo ✅ เสร็จ — เช็ค (รอเซิร์ฟเวอร์ขึ้นสัก 10-30 วิ):
echo    :3900 (สมองถอดคลิป)  http://localhost:3900/api/clip-transcript/gemini-health?list=3.7   ต้องได้ "success":true
echo    :3000 (ข่าว/หน้าเว็บ) http://localhost:3000/api/clip-transcript/queue-list              ต้องได้ "success":true
echo    (กติกา 15 ส.ค. 69: งานหนักถอดคลิปวิ่ง :3900 · :3000 เก็บไว้ให้ระบบข่าว · คิวแยกกันอยู่แล้ว clip-jobs กับ job_queue)
pause
