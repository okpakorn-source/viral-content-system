@echo off
rem ACS YouTube frame worker keeper - restart auto on crash (6 Jul 2026)
set PATH=C:\Program Files\nodejs;%PATH%
rem ★ ชี้ไปเซิร์ฟเวอร์งานหนัก :3900 (แยกจากเซิร์ฟเวอร์ข่าว :3000 — บทเรียน crash 6 ก.ค.)
set ACS_WORKER_BASE=http://localhost:3900
cd /d "C:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16"
:loop
echo [forever] starting acs-yt-worker %date% %time% >> _acs_yt_worker.log
node scripts\acs-yt-worker.mjs >> _acs_yt_worker.log 2>&1
echo [forever] acs-yt-worker exited - restart in 5s >> _acs_yt_worker.log
rem ★ 9 ก.ค.: ใช้ ping แทน timeout (timeout เด้ง error เมื่อ redirect log → ลูปหมุนรัวกิน CPU) · ping -n 6 = รอ ~5 วิ
ping -n 6 127.0.0.1 >nul
goto loop
