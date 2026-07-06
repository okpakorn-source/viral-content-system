@echo off
rem ACS YouTube job server keeper - port 3900 (6 Jul 2026)
rem เซิร์ฟเวอร์แยกเฉพาะงานแคปเฟรม YouTube — กัน pipeline หนักทำเซิร์ฟเวอร์ข่าว :3000 ตาย
rem (บทเรียน 6 ก.ค.: รัน pipeline ใน :3000 แล้ว server crash 2 รอบ 13:04/13:17)
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "C:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16"
:loop
echo [forever] starting acs-yt-server :3900 %date% %time% >> _acs_yt_server.log
call npx next start -p 3900 >> _acs_yt_server.log 2>&1
echo [forever] acs-yt-server exited - restart in 5s >> _acs_yt_server.log
timeout /t 5 /nobreak >nul
goto loop
