$ErrorActionPreference = 'Stop'
$wrapper = 'C:\Users\User\.codex\skills\model-orchestrator\scripts\Invoke-CodexWorker.cmd'
$workingDirectory = 'C:\tmp\airlock-deploy'
$promptFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\kimi-premerge-task.txt'
$outputFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\terra-premerge.output.txt'
$statusFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\terra-premerge.exit.txt'

& $wrapper `
  -WorkingDirectory $workingDirectory `
  -PromptFile $promptFile `
  -TaskSummary 'Read-only audit of three-way hunk selection for libraryTriage, refCoverLibrary, and acs-yt-worker' `
  -Model 'gpt-5.6-terra' `
  -Effort 'xhigh' `
  -Sandbox 'read-only' `
  -RunId 'airlock-terra-20260730-001' 2>&1 |
  Tee-Object -FilePath $outputFile

$exitCode = $LASTEXITCODE
[System.IO.File]::WriteAllText($statusFile, [string]$exitCode)
exit $exitCode
