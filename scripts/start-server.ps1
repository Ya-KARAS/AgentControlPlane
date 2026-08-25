# Starts the AgentControlPlane server on the configured loopback address.
#
# Provider credentials are optional. When ASTERROUTE_API_KEY exists in the
# current process or the Windows User environment, it is forwarded to the
# child process. Remote device relay pairing uses its own stored credential
# and must remain usable without a provider API key.
#
# Usage:
#   pwsh -File scripts/start-server.ps1            # detached, prints pid + health
#   pwsh -File scripts/start-server.ps1 -Foreground  # run in this terminal
param(
    [switch]$Foreground
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$key = $env:ASTERROUTE_API_KEY
if ([string]::IsNullOrWhiteSpace($key)) {
    $key = [Environment]::GetEnvironmentVariable("ASTERROUTE_API_KEY", "User")
}
if (-not [string]::IsNullOrWhiteSpace($key)) {
    $env:ASTERROUTE_API_KEY = $key
}

$healthUrl = "http://127.0.0.1:4318/health"

try {
    $existing = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    if ($existing.StatusCode -eq 200) {
        "already-running health=$($existing.StatusCode) body=$($existing.Content)"
        exit 0
    }
} catch {
    # No healthy listener exists yet; continue with startup.
}

if ($Foreground) {
    Set-Location $root
    node src/server.js
    exit $LASTEXITCODE
}

$runtime = Join-Path $root ".runtime"
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$stdoutLog = Join-Path $runtime "server.out.log"
$stderrLog = Join-Path $runtime "server.err.log"
$pidFile = Join-Path $runtime "server.pid"
$proc = Start-Process -FilePath "node" -ArgumentList "src/server.js" -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
$proc.Id | Set-Content -LiteralPath $pidFile -Encoding Ascii
"started pid=$($proc.Id)"

$deadline = (Get-Date).AddSeconds(15)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            "health=$($r.StatusCode) body=$($r.Content)"
            $healthy = $true
            break
        }
    } catch {
        # keep waiting while the server boots
    }
}
if (-not $healthy) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    "HEALTH_TIMEOUT pid=$($proc.Id)"
    if (Test-Path -LiteralPath $stderrLog) {
        Get-Content -LiteralPath $stderrLog -Tail 20
    }
    exit 1
}
