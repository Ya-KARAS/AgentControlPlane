# Installs a per-user Windows Startup shortcut for AgentControlPlane.
# The shortcut starts ACP hidden at sign-in and reuses start-server.ps1's
# duplicate-process and health checks.
param(
    [string]$StartupDirectory = [Environment]::GetFolderPath("Startup")
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$startScript = Join-Path $PSScriptRoot "start-server.ps1"
$shortcutPath = Join-Path $StartupDirectory "AgentControlPlane.lnk"
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path -LiteralPath $startScript -PathType Leaf)) {
    throw "start-server.ps1 was not found: $startScript"
}

New-Item -ItemType Directory -Force -Path $StartupDirectory | Out-Null
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7
$shortcut.Description = "Start AgentControlPlane local service"
$shortcut.Save()

"installed=$shortcutPath"
