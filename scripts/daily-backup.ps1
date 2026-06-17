$ErrorActionPreference='SilentlyContinue'
$src='C:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16'
$parent='C:\Users\User\แบ็คอัพระบบไวรัลรายวัน'
$d=Get-Date
$dest=Join-Path $parent ("แบ็คอัพ"+$d.Day+"-"+$d.Month)
New-Item -ItemType Directory -Force -Path $dest | Out-Null
robocopy $src $dest /E /R:1 /W:1 /MT:16 /NFL /NDL /NP /NJH /NJS | Out-Null
$line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm') | FULL backup -> $dest | exit=$LASTEXITCODE"
$line | Out-File -Append -Encoding utf8 (Join-Path $parent '_backup-log.txt')
