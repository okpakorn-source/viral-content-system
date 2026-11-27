# 🔁 run-sub-ultra-loop.ps1 — ลูปรันตัวทำข่าว Sub Ultra ถาวร (ไม่พึ่ง C:\tmp)
$ErrorActionPreference = 'Continue'
$repoRoot = 'C:\viral-content-system-dev'
$logDir = 'C:\tmp\news-pipeline-runtime-r133-control'
if (-not (Test-Path -LiteralPath $logDir)) {
  $logDir = Join-Path $repoRoot 'logs'
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}
$logPath = Join-Path $logDir 'sub-ultra-news.log'

Set-Location -LiteralPath $repoRoot
$env:NODE_ENV = 'production'

while ($true) {
  # หมุนไฟล์ log อัตโนมัติถ้าเกิน 25MB กันดิสก์เต็ม
  try {
    if ((Test-Path -LiteralPath $logPath) -and ((Get-Item -LiteralPath $logPath).Length -gt 26214400)) {
      Move-Item -LiteralPath $logPath -Destination "$logPath.old" -Force -ErrorAction SilentlyContinue
    }
  } catch {}

  "[$(Get-Date -Format o)] start sub-ultra-news-worker (Turbo)" | Out-File -FilePath $logPath -Append -Encoding utf8
  & node '.\scripts\sub-ultra-news-worker.mjs' 2>&1 | ForEach-Object {
    "$_" | Out-File -FilePath $logPath -Append -Encoding utf8
  }
  "[$(Get-Date -Format o)] sub-ultra-news-worker exited (code $LASTEXITCODE); restart in 3s" | Out-File -FilePath $logPath -Append -Encoding utf8
  Start-Sleep -Seconds 3
}
