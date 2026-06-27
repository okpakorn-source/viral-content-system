@echo off
rem === ViralFlow Team Queue Poller (27 มิ.ย. 2026) ===
rem   กระตุ้น /api/queue/worker บนเครื่องทีมเป็นระยะ → คว้า+ทำงาน "ปก/คลิปที่ต้อง yt-dlp" ที่ Vercel เด้งมา
rem   เหตุผล: งานปกที่มีลิงก์วิดีโอ (YouTube/TikTok/FB/IG) → routing บังคับเครื่องทีม (canRunHere=win32 เท่านั้น)
rem           Vercel ข้ามงานพวกนี้ (รัน yt-dlp ไม่ได้) → ต้องมีตัวกระตุ้น worker บนเครื่องทีมมาคว้าเอง
rem   worker ทำ 1 งาน/ครั้ง (concurrency 1) · curl -m 900 รอจนงานเสร็จ (กัน client disconnect ตัดงานกลางคัน)
rem   ไม่มีงาน/กำลังทำ = worker คืนเร็ว → loop ต่อ · 🔴 แตะเฉพาะการ "กระตุ้น" — ไม่แตะ logic ข่าว/ปก
:loop
curl -s -m 900 -X POST http://localhost:3000/api/queue/worker >nul 2>&1
timeout /t 15 /nobreak >nul
goto loop
