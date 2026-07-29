$ErrorActionPreference = 'Continue'
$wrapper = 'C:\Users\User\.codex\skills\model-orchestrator\scripts\Invoke-AntigravityWorker.cmd'
$workingDirectory = 'C:\tmp\airlock-deploy'
$promptFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\antigravity-final-review-task.txt'
$stdoutFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\antigravity-final-review.stdout.txt'
$stderrFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\antigravity-final-review.stderr.txt'
$statusFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\antigravity-final-review.exit.txt'

& $wrapper `
  -WorkingDirectory $workingDirectory `
  -PromptFile $promptFile `
  -TaskSummary 'Read-only final audit of assembled airlock deploy diff and preservation of origin/main WIP' `
  -Model 'Claude Opus 4.6 (Thinking)' `
  -Mode 'plan' `
  -RunId 'airlock-agy-opus-20260730-001' 1> $stdoutFile 2> $stderrFile

$exitCode = $LASTEXITCODE
[System.IO.File]::WriteAllText($statusFile, [string]$exitCode)
exit $exitCode
