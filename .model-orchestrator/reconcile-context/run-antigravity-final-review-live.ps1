$ErrorActionPreference = 'Continue'
$workingDirectory = 'C:\tmp\airlock-deploy'
$promptFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\antigravity-final-review-task.txt'
$stdoutFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\antigravity-final-review-live.stdout.txt'
$stderrFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\antigravity-final-review-live.stderr.txt'
$statusFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\antigravity-final-review-live.exit.txt'
$logger = 'C:\Users\User\.codex\skills\model-orchestrator\scripts\Write-ModelInvocation.cmd'
$runId = 'airlock-agy-opus-20260730-002'
$model = 'claude-opus-4-6-thinking'
$purpose = 'Read-only final audit of assembled airlock deploy diff and preservation of origin/main WIP'
$agy = (Get-Command 'agy' -ErrorAction Stop | Select-Object -First 1).Source
$taskPrompt = Get-Content -LiteralPath $promptFile -Raw -Encoding UTF8

$guardrails = @"
You are a delegated coding worker. Do not delegate this task to other agents.
Work only inside: $workingDirectory
Do not read or change files outside that directory.
Do not commit, push, open a pull request, publish, deploy, install dependencies, access credentials, or make destructive changes.
Respect the requested scope. At the end, report files changed, checks run, and any unresolved risk.

Task:
$taskPrompt
"@

& $logger -Provider 'antigravity' -Model $model -Mode 'plan' -Role 'delegated-worker' -Purpose $purpose -Status 'started' -WorkingDirectory $workingDirectory -RunId $runId | Out-Null
Set-Location -LiteralPath $workingDirectory
& $agy --sandbox --mode plan --model $model --print $guardrails --print-timeout 10m 1> $stdoutFile 2> $stderrFile
$exitCode = $LASTEXITCODE
if ($exitCode -eq 0) {
  & $logger -Provider 'antigravity' -Model $model -Mode 'plan' -Role 'delegated-worker' -Purpose $purpose -Status 'succeeded' -WorkingDirectory $workingDirectory -RunId $runId -ExitCode $exitCode -Evidence 'Antigravity CLI exited 0.' | Out-Null
} else {
  & $logger -Provider 'antigravity' -Model $model -Mode 'plan' -Role 'delegated-worker' -Purpose $purpose -Status 'failed' -WorkingDirectory $workingDirectory -RunId $runId -ExitCode $exitCode -Evidence "Antigravity CLI exited $exitCode." | Out-Null
}
[System.IO.File]::WriteAllText($statusFile, [string]$exitCode)
exit $exitCode
