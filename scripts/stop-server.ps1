# Stops the AgentControlPlane server listening on the configured loopback port.
#
# Usage:
#   pwsh -File scripts/stop-server.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root ".runtime\server.pid"

$procIds = @()
$conns = Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $procIds = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
} else {
    # Get-NetTCPConnection can return no rows in restricted Windows sessions
    # even when the loopback listener exists. Fall back to the system netstat
    # view so upgrades do not leave an older ACP process running indefinitely.
    $netstatLines = & netstat.exe -ano -p tcp 2>$null
    foreach ($line in $netstatLines) {
        if ($line -match '^\s*TCP\s+\S+:4318\s+\S+\s+LISTENING\s+(\d+)\s*$') {
            $procIds += [int]$Matches[1]
        }
    }
    $procIds = @($procIds | Sort-Object -Unique)
}

if ($procIds.Count -eq 0) {
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    "no listener on 127.0.0.1:4318"
    exit 0
}

foreach ($procId in $procIds) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq "node") {
        Stop-Process -Id $procId -Force
        "stopped pid=$procId"
    } else {
        $name = if ($proc) { $proc.ProcessName } else { "unknown" }
        "skip pid=$procId name=$name"
    }
}
Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
