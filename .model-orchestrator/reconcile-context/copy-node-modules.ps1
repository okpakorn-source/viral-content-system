$ErrorActionPreference = 'Stop'
$source = 'C:\Users\User\แบล็กอัพก่อนแก้2เวอร์ชัน27-5-12.16\node_modules'
$destination = 'C:\tmp\airlock-deploy\node_modules'
$stdoutFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\copy-node-modules.stdout.txt'
$stderrFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\copy-node-modules.stderr.txt'
$statusFile = 'C:\tmp\airlock-deploy\.model-orchestrator\reconcile-context\copy-node-modules.exit.txt'

& robocopy.exe $source $destination /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP 1> $stdoutFile 2> $stderrFile
$robocopyExit = $LASTEXITCODE
[System.IO.File]::WriteAllText($statusFile, [string]$robocopyExit)
if ($robocopyExit -ge 8) { exit 1 }
exit 0
