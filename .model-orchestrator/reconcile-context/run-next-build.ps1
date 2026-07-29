$ErrorActionPreference = 'Continue'
$env:NEXT_DISTDIR = '.next-airlock-deploy'
$workingDirectory = 'C:\tmp\airlock-deploy'
$npx = 'C:\Program Files\nodejs\npx.cmd'
$stdoutFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\next-build.stdout.txt'
$stderrFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\next-build.stderr.txt'
$statusFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\next-build.exit.txt'

Set-Location -LiteralPath $workingDirectory
& $npx next build 1> $stdoutFile 2> $stderrFile
$exitCode = $LASTEXITCODE
[System.IO.File]::WriteAllText($statusFile, [string]$exitCode)
exit $exitCode
