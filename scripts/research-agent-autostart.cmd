@echo off
rem ==========================================================================
rem research-agent-autostart.cmd - guard/keeper for the Research Agent worker
rem   SPEC-v2 sec 8, backup plan layer 1 (autostart on the owner's machine)
rem   1 Oct 2026 (lane D ops) - full guide in Thai: docs\RESEARCH-AGENT.md
rem   r2: the stop flag is the worker's own flag file (RA_STOP below)
rem
rem Safe to run any number of times (idempotent):
rem   1. stop flag logs\research-agent\research-agent.stop exists -> do nothing
rem      (paused on purpose; the same file that the worker's --stop creates,
rem      --resume removes and research-agent-worker-forever.cmd waits on)
rem   2. a node.exe/cmd.exe process whose command line contains
rem      "research-agent-worker" is running -> do nothing (never a second worker)
rem   3. otherwise start scripts\research-agent-worker-forever.cmd in a hidden
rem      window and append one line to logs\research-agent-autostart.log
rem      (logs\ is gitignored)
rem Never reads or prints any key: the worker loads .env.local by itself.
rem ASCII only, no hard-coded path: the repo root comes from this file's own
rem location, so it also works when the folder name has Thai characters.
rem
rem The worker runs in a hidden window - there is no window to close.
rem From the repo root:
rem   pause   : node scripts\research-agent-worker.mjs --stop
rem             (the running job finishes, the worker exits, forever.cmd waits)
rem   resume  : node scripts\research-agent-worker.mjs --resume
rem   stop now: end the node.exe and cmd.exe processes whose command line
rem             contains research-agent-worker (without the stop flag this
rem             guard starts the worker again on its next run)
rem
rem Task Scheduler (the owner registers it ONCE, from the repo root, in PowerShell;
rem this file never registers itself):
rem   $guard = (Resolve-Path .\scripts\research-agent-autostart.cmd).Path
rem   schtasks /Create /TN ViralFlow-ResearchAgent /SC MINUTE /MO 5 /TR $guard /F
rem   check  : schtasks /Query /TN ViralFlow-ResearchAgent
rem   disable: schtasks /Change /TN ViralFlow-ResearchAgent /DISABLE  (re-enable: /ENABLE)
rem   remove : schtasks /Delete /TN ViralFlow-ResearchAgent /F
rem   disable/remove only stop new starts - a running worker keeps running
rem Exit code: 0 = already running / started / paused by flag, 1 = cannot start
rem ==========================================================================
setlocal
rem Windows tools first for everything started from here: launched from Git Bash
rem (MSYS PATH) "timeout" resolves to GNU timeout, which exits at once on "/t"
rem and turns the waits in research-agent-worker-forever.cmd into a busy loop
set "PATH=%SystemRoot%\System32;%PATH%"
for %%I in ("%~dp0..") do set "RA_ROOT=%%~fI"
set "RA_FOREVER=%RA_ROOT%\scripts\research-agent-worker-forever.cmd"
rem must stay the same file as the worker's stopFile and forever.cmd's STOPFLAG
set "RA_STOP=%RA_ROOT%\logs\research-agent\research-agent.stop"
set "RA_LOGDIR=%RA_ROOT%\logs"
set "RA_LOG=%RA_LOGDIR%\research-agent-autostart.log"
rem the pattern travels via env so the PowerShell command line never matches itself
set "RA_MATCH=research-agent-worker"

if not exist "%RA_LOGDIR%" mkdir "%RA_LOGDIR%" >nul 2>&1

if exist "%RA_STOP%" (
  echo [research-agent-autostart] stop flag logs\research-agent\research-agent.stop present - not starting - resume with: node scripts\research-agent-worker.mjs --resume
  exit /b 0
)
if not exist "%RA_FOREVER%" (
  >>"%RA_LOG%" echo [%date% %time%] cannot start: scripts\research-agent-worker-forever.cmd not found
  echo [research-agent-autostart] missing scripts\research-agent-worker-forever.cmd
  exit /b 1
)

powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$m = $env:RA_MATCH; $p = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='cmd.exe'\" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($m) }); if ($p.Count -gt 0) { exit 10 }; Start-Process -FilePath $env:ComSpec -ArgumentList ('/c ' + [char]34 + $env:RA_FOREVER + [char]34) -WorkingDirectory $env:RA_ROOT -WindowStyle Hidden; exit 0"
set "RA_RC=%ERRORLEVEL%"
if "%RA_RC%"=="10" (
  echo [research-agent-autostart] worker already running
  exit /b 0
)
if "%RA_RC%"=="0" (
  >>"%RA_LOG%" echo [%date% %time%] started scripts\research-agent-worker-forever.cmd hidden
  echo [research-agent-autostart] started worker keeper
  exit /b 0
)
>>"%RA_LOG%" echo [%date% %time%] start failed - powershell exit %RA_RC%
echo [research-agent-autostart] start failed - powershell exit %RA_RC%
exit /b 1
