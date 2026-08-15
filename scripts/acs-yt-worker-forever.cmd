@echo off
rem ACS YouTube frame worker keeper - restart auto on crash (6 Jul 2026)
set PATH=C:\Program Files\nodejs;%PATH%
rem ★ ชี้ไปเซิร์ฟเวอร์งานหนัก :3900 (แยกจากเซิร์ฟเวอร์ข่าว :3000 — บทเรียน crash 6 ก.ค.)
set ACS_WORKER_BASE=http://localhost:3900
rem ★ 18 ก.ค.: เปิด mega tick คืน — rebuild .next-3900 จาก main (มี rt_*) เสร็จแล้ว (BUILD_ID Gq-00ij4q..., 01:27)
rem   เงื่อนไขที่ปิดไว้ 17 ก.ค. (build เก่ากว่าคิว rt_* ทำ tick ฆ่างานคิว) หมดไปแล้ว · env ไม่ตั้ง = tick เปิด (worker เช็ค !== '0')
rem   ถ้าต้องปิดฉุกเฉินอีก: ใส่บรรทัด  set ACS_WORKER_MEGA_TICK=0  กลับมา
rem ★ 15 ส.ค. 69 (เจ้าของสั่ง "ให้เป็นโค้ดใหม่ทั้งหมด"): ย้ายมาโฟลเดอร์ตาม main/Vercel
rem   เดิมชี้กลับโฟลเดอร์แบล็กอัพ — สคริปต์อยู่ npd แต่ cd กลับของเก่า = รันโค้ดเก่าเงียบๆ
cd /d "C:\news-pipeline-dev"
:loop
echo [forever] starting acs-yt-worker %date% %time% >> _acs_yt_worker.log
node scripts\acs-yt-worker.mjs >> _acs_yt_worker.log 2>&1
echo [forever] acs-yt-worker exited - restart in 5s >> _acs_yt_worker.log
rem ★ 9 ก.ค.: ใช้ ping แทน timeout (timeout เด้ง error เมื่อ redirect log → ลูปหมุนรัวกิน CPU) · ping -n 6 = รอ ~5 วิ
ping -n 6 127.0.0.1 >nul
goto loop
