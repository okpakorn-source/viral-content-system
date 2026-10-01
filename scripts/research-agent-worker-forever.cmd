@echo off
rem ViralFlow research-agent worker keeper (SPEC-v2 section 8) - restarts on crash, respects the stop flag
rem   stop gracefully : node scripts\research-agent-worker.mjs --stop   (running jobs finish and report - up to RESEARCH_AGENT_CONCURRENCY - then this loop waits)
rem   resume          : node scripts\research-agent-worker.mjs --resume
rem   config error (exit 3: RESEARCH_AGENT_SECRET / RESEARCH_AGENT_API_BASE missing in .env.local) - retry every 5 minutes
rem   backup plan: run this same file on the team machine with another RESEARCH_AGENT_WORKER_ID (lease prevents duplicates)
setlocal
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0.."
set "STOPFLAG=logs\research-agent\research-agent.stop"
:loop
if exist "%STOPFLAG%" goto paused
echo [forever] starting research-agent-worker %date% %time%
node scripts\research-agent-worker.mjs
set "CODE=%errorlevel%"
if "%CODE%"=="3" goto configwait
echo [forever] worker exited with code %CODE% - restart in 10s
timeout /t 10 /nobreak >nul
goto loop
:paused
echo [forever] stop flag present - waiting 30s - remove it with: node scripts\research-agent-worker.mjs --resume
timeout /t 30 /nobreak >nul
goto loop
:configwait
echo [forever] config incomplete - see logs\research-agent\worker.log - retry in 300s
timeout /t 300 /nobreak >nul
goto loop
