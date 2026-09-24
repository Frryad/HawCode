# ==============================================================================
# HawHost — Windows Automatic Startup Service Uninstaller
# ==============================================================================

#Requires -Version 5.1

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[INFO] Elevating permissions to remove Windows Scheduled Task..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$taskName = "HawHost Server"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  HawHost Web Server — Windows Boot Service Removal" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "[SUCCESS] HawHost Automatic Startup Task '$taskName' has been removed." -ForegroundColor Green
} else {
    Write-Host "[INFO] Task '$taskName' was not found or already removed." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
