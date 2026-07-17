@echo off
rem === ยาม acs-yt-worker (17 ก.ค.): เช็คทุก 30 นาทีผ่าน Task Scheduler — ตายเมื่อไหร่จุดใหม่เอง ===
rem เหตุ: worker เคยโดนปิดกลางวัน (หน้าต่างถูกปิด/kill) แล้วเฟรม YouTube ไม่มีใครแคปจนภาพแตกทั้งแถบ
rem ตรวจด้วย PowerShell: มี node ที่ commandline มี acs-yt-worker ไหม — ไม่มี = start forever.cmd แบบซ่อนหน้าต่าง
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'acs-yt-worker' }; if (-not $p) { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c scripts\acs-yt-worker-forever.cmd' -WorkingDirectory 'C:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16' -WindowStyle Hidden; Add-Content -Path 'C:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16\_acs_yt_worker.log' -Value (\"[guard] worker ตาย - จุดใหม่ \" + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) }"
