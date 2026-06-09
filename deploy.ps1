#!/usr/bin/env pwsh
# deploy.ps1 — Commit + Push ทั้ง master และ main พร้อมกัน
# Usage: .\deploy.ps1 "commit message"

param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$ErrorActionPreference = "Stop"

Write-Host "`n=== Auto Deploy Script ===" -ForegroundColor Cyan

# 1. Stage all changes
Write-Host "[1/5] Staging all changes..." -ForegroundColor Yellow
git add -A

# 2. Check if there are changes to commit
$status = git status --porcelain
if (-not $status) {
    Write-Host "No changes to commit!" -ForegroundColor Green
    exit 0
}

# 3. Commit on current branch (master)
Write-Host "[2/5] Committing on master..." -ForegroundColor Yellow
git commit -m $Message

# 4. Push master
Write-Host "[3/5] Pushing master..." -ForegroundColor Yellow
git push origin master

# 5. Merge to main and push (for Vercel)
Write-Host "[4/5] Merging to main + pushing..." -ForegroundColor Yellow
git checkout main
git merge master -m "merge: $Message"
git push origin main

# 6. Back to master
Write-Host "[5/5] Switching back to master..." -ForegroundColor Yellow
git checkout master

Write-Host "`n✅ Deploy complete! Both master and main are synced." -ForegroundColor Green
Write-Host "   Vercel will auto-deploy from main branch." -ForegroundColor DarkGray
