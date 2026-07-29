# killer-hunt.ps1 - non-admin watcher: catch what spawns at the moment :3900's node dies
# Start: powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts\killer-hunt.ps1
# Log:   _killer-hunt.log (repo root) - English only (PS5.1 ANSI-safe)
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root '_killer-hunt.log'
function Log($msg) { ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $msg) | Out-File -FilePath $log -Append -Encoding utf8 }

Log "=== killer-hunt started (pid=$PID) ==="
while ($true) {
  # find the pid listening on :3900
  $victim = $null
  while (-not $victim) {
    $line = netstat -ano | Select-String ':3900\s' | Select-String 'LISTENING' | Select-Object -First 1
    if ($line) { $victim = ($line -split '\s+')[-1] } else { Start-Sleep -Seconds 3 }
  }
  Log "watching victim pid=$victim"
  # baseline snapshot of all pids
  $prev = @{}
  Get-Process | ForEach-Object { $prev[$_.Id] = $_.ProcessName }
  $alive = $true
  while ($alive) {
    Start-Sleep -Milliseconds 400
    $p = Get-Process -Id $victim -ErrorAction SilentlyContinue
    if (-not $p) { $alive = $false; break }
    # refresh baseline every ~2s (5 ticks) so "new since death" window stays tight
    if ((Get-Random -Maximum 5) -eq 0) {
      $prev = @{}
      Get-Process | ForEach-Object { $prev[$_.Id] = $_.ProcessName }
    }
  }
  $deathAt = Get-Date
  Log "!!! victim pid=$victim DIED at $($deathAt.ToString('HH:mm:ss.fff'))"
  # immediately dump processes created in the last 8 seconds with full command lines
  $cutoff = $deathAt.AddSeconds(-8)
  $suspects = Get-CimInstance Win32_Process | Where-Object {
    $_.CreationDate -and ([Management.ManagementDateTimeConverter]::ToDateTime($_.CreationDate) -gt $cutoff)
  }
  if ($suspects) {
    foreach ($s in $suspects) {
      $born = [Management.ManagementDateTimeConverter]::ToDateTime($s.CreationDate).ToString('HH:mm:ss.fff')
      Log ("SUSPECT born=$born pid=$($s.ProcessId) ppid=$($s.ParentProcessId) name=$($s.Name) cmd=" + ($s.CommandLine -replace '\r|\n',' '))
    }
  } else { Log "no new process in 8s window (killer may be a long-running process calling TerminateProcess directly - needs admin audit to catch)" }
  # also record which pids vanished alongside the victim (collateral kills)
  $now = @{}
  Get-Process | ForEach-Object { $now[$_.Id] = $_.ProcessName }
  $gone = @()
  foreach ($k in $prev.Keys) { if (-not $now.ContainsKey($k)) { $gone += "$k($($prev[$k]))" } }
  Log ("also-vanished: " + ($gone -join ' '))
  Log "--- resuming watch (keeper should revive :3900 soon) ---"
  Start-Sleep -Seconds 10
}
