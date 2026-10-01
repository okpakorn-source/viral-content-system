@echo off
rem research-agent Codex account helper (SPEC-v2 section 8 - connect a new account as easily as possible)
rem   research-agent-account add LETTER        sign in another ChatGPT/Codex account into %USERPROFILE%\.codex-LETTER (browser login)
rem   research-agent-account add main          re-login the default account (%USERPROFILE%\.codex)
rem   research-agent-account use LETTER [...]  write RESEARCH_AGENT_CODEX_ACCOUNTS=LETTER,... into .env.local (restart the worker)
rem   research-agent-account status            quota table of every Codex account on this machine (free, burns no tokens)
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0.."
set "ACTION=%~1"
if /i "%ACTION%"=="add" goto add
if /i "%ACTION%"=="use" goto use
if /i "%ACTION%"=="status" goto status
echo usage: research-agent-account add LETTER ^| use LETTER [LETTER ...] ^| status
exit /b 2

:add
set "NAME=%~2"
if "%NAME%"=="" goto addusage
node scripts\research-agent\accounts.mjs check-name "%NAME%"
if errorlevel 1 exit /b 2
if /i "%NAME%"=="main" goto addmain
set "ADDPS=%USERPROFILE%\.claude\skills\auto-account\scripts\add-codex-account.ps1"
if not exist "%ADDPS%" goto addplain
powershell -NoProfile -ExecutionPolicy Bypass -File "%ADDPS%" -Name "%NAME%"
goto status
:addplain
if not exist "%USERPROFILE%\.codex-%NAME%" mkdir "%USERPROFILE%\.codex-%NAME%"
set "OPENAI_API_KEY="
set "CODEX_HOME=%USERPROFILE%\.codex-%NAME%"
call codex login
goto status
:addmain
set "OPENAI_API_KEY="
set "CODEX_HOME="
call codex login
goto status
:addusage
echo usage: research-agent-account add LETTER
exit /b 2

:use
shift
set "LIST="
:useloop
if "%~1"=="" goto usedone
if defined LIST (set "LIST=%LIST%,%~1") else (set "LIST=%~1")
shift
goto useloop
:usedone
if not defined LIST goto useusage
node scripts\research-agent\accounts.mjs use "%LIST%"
exit /b %errorlevel%
:useusage
echo usage: research-agent-account use LETTER [LETTER ...]   e.g. research-agent-account use b main
exit /b 2

:status
node scripts\research-agent\accounts.mjs status
exit /b %errorlevel%
