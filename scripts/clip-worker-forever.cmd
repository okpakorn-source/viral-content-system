@echo off
rem ViralFlow Clip Worker keeper - restart auto on crash
set PATH=C:\Program Files\nodejs;%PATH%
cd /d C:\news-pipeline-dev
rem ★ 15 ส.ค. 69 (เจ้าของสั่งแยกพอร์ต): งานหนักถอดคลิปวิ่งใน :3900 (acs-yt-server) — :3000 เก็บไว้ให้ระบบข่าว
rem   คิวไม่ปนกันอยู่แล้ว (clip-jobs vs job_queue) — ที่ย้ายคือ "โปรเซสที่ทำงานหนัก" เท่านั้น
set CLIP_WORKER_BASE=http://localhost:3900
:loop
echo [forever] starting clip-worker %date% %time%
node scripts\clip-worker.mjs
echo [forever] clip-worker exited - restart in 5s
timeout /t 5 /nobreak >nul
goto loop
