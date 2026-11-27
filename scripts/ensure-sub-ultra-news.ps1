# 🛡️ ensure-sub-ultra-news.ps1 — ตัวเฝ้าตรวจชีพจรจริง (/health) ทุก 1 นาที + ตอนเปิดเครื่อง
$ErrorActionPreference = 'Continue'
$repoRoot = 'C:\viral-content-system-dev'
$loopScript = Join-Path $repoRoot 'scripts\run-sub-ultra-loop.ps1'
$healthUrl = 'http://127.0.0.1:3955/health'
$logDir = 'C:\tmp\news-pipeline-runtime-r133-control'
if (-not (Test-Path -LiteralPath $logDir)) {
  $logDir = Join-Path $repoRoot 'logs'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}
$guardLog = Join-Path $logDir 'sub-ultra-guard.log'

function Write-GuardLog([string]$msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  try { Add-Content -LiteralPath $guardLog -Value $line -Encoding utf8 } catch {}
}

function Test-WorkerHealthy {
  for ($i = 0; $i -lt 2; $i++) {
    try {
      $res = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 4 -ErrorAction Stop
      if ($res -and $res.ok -eq $true) { return $true }
    } catch {}
    if ($i -eq 0) { Start-Sleep -Seconds 2 }
  }
  return $false
}

# 1. ถ้า /health ตอบกลับปกติ = ทำงานดีอยู่แล้ว ไม่ต้องแตะ
if (Test-WorkerHealthy) {
  exit 0
}

# 2. ถ้า /health ไม่ตอบกลับ: เคลียร์โปรเซสเก่าที่อาจค้าง (zombie) แล้วสตาร์ตใหม่ทันที
Write-GuardLog "⚠️ พอร์ต 3955 ไม่ตอบสนอง — กำลังชุบชีวิต Sub-Ultra News Worker ใหม่..."

try {
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -like '*sub-ultra-news-worker.mjs*' -or
    $_.CommandLine -like '*sub-ultra-news-r133.ps1*' -or
    $_.CommandLine -like '*run-sub-ultra-loop.ps1*'
  } | ForEach-Object {
    if ($_.ProcessId -ne $PID) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }
} catch {}

Start-Sleep -Seconds 1

if (-not (Test-Path -LiteralPath $loopScript)) {
  Write-GuardLog "❌ ไม่พบไฟล์ $loopScript"
  exit 1
}

try {
  $conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
  $psArgs = "--headless powershell.exe -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$loopScript`""
  Start-Process -FilePath $conhost -ArgumentList $psArgs -WindowStyle Hidden | Out-Null
  Start-Sleep -Seconds 3
  if (Test-WorkerHealthy) {
    Write-GuardLog "✅ ชุบชีวิต Sub-Ultra News Worker สำเร็จ (/health = OK)"
  } else {
    Write-GuardLog "⏳ สั่งสตาร์ต Sub-Ultra News Worker แล้ว (รอพอร์ตตื่น)"
  }
} catch {
  Write-GuardLog "❌ สตาร์ตไม่สำเร็จ: $($_.Exception.Message)"
}
