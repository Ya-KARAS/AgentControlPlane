# Stops the AgentControlPlane server listening on the configured loopback port.
#
# Usage:
#   pwsh -File scripts/stop-server.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".runtime\server.pid"

$conns = Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue
if (-not $conns) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    "no listener on 127.0.0.1:4318"
    exit 0
}

$procIds = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($procId in $procIds) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    if ($proc.Name -eq "node.exe") {
        Stop-Process -Id $procId -Force
        "stopped pid=$procId"
    } else {
        "skip pid=$procId name=$($proc.Name)"
    }
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
