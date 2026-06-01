# ===================================================
# YouTube Cookie Exporter for yt-dlp
# วิธีใช้: รันสคริปต์นี้ใน PowerShell
# ===================================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   YouTube Cookie Exporter (สำหรับ yt-dlp)" -ForegroundColor Cyan  
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "สคริปต์นี้จะ:" -ForegroundColor Yellow
Write-Host "  1. เปิด Chrome ไปที่ YouTube.com"
Write-Host "  2. รอให้คุณ Login YouTube (ถ้ายังไม่ได้ Login)"
Write-Host "  3. ใช้ yt-dlp export cookies จาก browser profile"
Write-Host ""

$binDir = Join-Path $PSScriptRoot "..\bin"
$cookiesPath = Join-Path $binDir "cookies.txt"
$ytdlpPath = Join-Path $binDir "yt-dlp.exe"

# ลองใช้ Firefox ก่อน (ไม่มีปัญหา DPAPI)
Write-Host "กำลังลองดึง cookies จาก Firefox..." -ForegroundColor Yellow
try {
    & $ytdlpPath --cookies-from-browser firefox --cookies $cookiesPath --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1 | Out-Null
    if (Test-Path $cookiesPath) {
        $size = (Get-Item $cookiesPath).Length
        if ($size -gt 100) {
            Write-Host "✅ สำเร็จ! ดึง cookies จาก Firefox ได้แล้ว ($size bytes)" -ForegroundColor Green
            Write-Host "   ไฟล์: $cookiesPath" -ForegroundColor Green
            exit 0
        }
    }
} catch {}

Write-Host "Firefox ไม่พบ กำลังลอง Chrome..." -ForegroundColor Yellow

# ปิด Chrome ก่อน (จำเป็นสำหรับบาง version)
Write-Host ""
Write-Host "⚠️  กรุณาปิด Chrome ทั้งหมดก่อน แล้วกด Enter" -ForegroundColor Red
Read-Host "กด Enter เมื่อปิด Chrome แล้ว"

try {
    & $ytdlpPath --cookies-from-browser chrome --cookies $cookiesPath --skip-download "https://www.youtube.com/watch?v=dQw4w9WgXcQ" 2>&1
    if (Test-Path $cookiesPath) {
        $size = (Get-Item $cookiesPath).Length
        if ($size -gt 100) {
            Write-Host "✅ สำเร็จ! ดึง cookies จาก Chrome ได้แล้ว ($size bytes)" -ForegroundColor Green
            Write-Host "   ไฟล์: $cookiesPath" -ForegroundColor Green
            exit 0
        }
    }
} catch {}

Write-Host ""
Write-Host "❌ ไม่สามารถดึง cookies อัตโนมัติได้" -ForegroundColor Red
Write-Host ""
Write-Host "วิธีแก้ด้วยตนเอง:" -ForegroundColor Yellow
Write-Host "  1. ติดตั้ง Chrome Extension: 'Get cookies.txt LOCALLY'" -ForegroundColor White
Write-Host "     https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc" -ForegroundColor Blue
Write-Host "  2. ไปที่ youtube.com (ต้อง Login แล้ว)" -ForegroundColor White
Write-Host "  3. คลิก Extension แล้วกด 'Export'" -ForegroundColor White
Write-Host "  4. บันทึกไฟล์เป็น: $cookiesPath" -ForegroundColor White
Write-Host ""
