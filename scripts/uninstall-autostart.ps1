# Removes the per-user Windows Startup shortcut created by install-autostart.ps1.
param(
    [string]$StartupDirectory = [Environment]::GetFolderPath("Startup")
)

$ErrorActionPreference = "Stop"
$shortcutPath = Join-Path $StartupDirectory "AgentControlPlane.lnk"
Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue
"removed=$shortcutPath"
