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

echo [3/5] next build (เผื่อพอร์ตที่รันแบบ next start) ...
call npx next build
if errorlevel 1 (echo ❌ build ล้ม — ดู error ด้านบน & pause & exit /b 1)

echo [4/5] ปิดโปรเซสเดิมบนพอร์ต 3000 ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr LISTENING') do taskkill /f /pid %%p >nul 2>&1

echo [5/5] เปิดใหม่: dev server (3000) + clip-worker ...
start "clip-dev-3000" cmd /k npm run dev
start "clip-worker" cmd /k node scripts\clip-worker.mjs

echo.
echo ✅ เสร็จ — เช็คโค้ดใหม่ (รอ dev ขึ้นสัก 10-20 วิ):
echo    http://localhost:3000/api/clip-transcript/gemini-health?list=3.7   ต้องได้ "success":true
echo.
echo ⚠️ พอร์ต 3900: สคริปต์นี้ไม่แตะ (ไม่รู้คำสั่งเปิดเฉพาะของพอร์ตนั้น) —
echo    ถ้าใช้อยู่ ให้ปิดหน้าต่างเดิมแล้วเปิดใหม่ตามวิธีที่ทีมใช้ (โค้ดที่ build แล้วเป็นรุ่นใหม่ให้อัตโนมัติ)
pause
