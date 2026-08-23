@echo off
REM 🔒🏆 ติดตั้งด่านล็อกระบบข่าวยุคปัง (pre-commit + pre-push) ลงใน .git ของรีโปนี้ — รันจากโฟลเดอร์ใดก็ได้ใน worktree
for /f "delims=" %%G in ('git rev-parse --git-common-dir') do set GITDIR=%%G
if "%GITDIR%"=="" ( echo ไม่เจอ .git & exit /b 1 )
for /f "delims=" %%R in ('git rev-parse --show-toplevel') do set ROOT=%%R
copy /Y "%ROOT%\scripts\golden-lock\hooks\pre-commit" "%GITDIR%\hooks\pre-commit" >nul
copy /Y "%ROOT%\scripts\golden-lock\hooks\pre-push" "%GITDIR%\hooks\pre-push" >nul
echo ติดตั้งแล้ว: %GITDIR%\hooks\pre-commit , pre-push
echo ตรวจยุคปัง: node scripts\golden-lock\check-golden-lock.mjs
