# ==============================================================================
# HawHost — Windows Automatic Startup Service Installer
# ==============================================================================
# This script installs a persistent Windows Scheduled Task that starts the
# HawHost web server engine automatically at system boot (before user login)
# and ensures continuous 24/7 self-hosting uptime without external tunnels.
# ==============================================================================

#Requires -Version 5.1

# Ensure Administrator rights
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[INFO] Elevating permissions to register Windows Scheduled Task..." -ForegroundColor Yellow
    Start-Process powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$taskName = "HawHost Server"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$daemonScript = Join-Path $appDir "daemon\daemon.js"
$dataDir = Join-Path $env:APPDATA "HawHost"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  HawHost Web Server — Windows Boot Service Setup" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# Locate Node.js or HawHost executable
$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$hawhostExe = Join-Path $appDir "HawHost.exe"
$programExe = ""
$arguments = ""

if (Test-Path $hawhostExe) {
    $programExe = $hawhostExe
    $arguments = "--hidden"
    Write-Host "[OK] Using compiled HawHost binary: $hawhostExe" -ForegroundColor Green
} elseif ($nodeExe) {
    $programExe = $nodeExe
    $arguments = "`"$daemonScript`" --data-dir `"$dataDir`" --service"
    Write-Host "[OK] Using Node.js engine: $nodeExe" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Neither HawHost.exe nor Node.js was found in PATH." -ForegroundColor Red
    pause
    exit 1
}

# Determine current user account for S4U logon
$currentUser = "$env:USERDOMAIN\$env:USERNAME"
Write-Host "[INFO] Registering service for user account: $currentUser" -ForegroundColor Gray

# Define Scheduled Task Action, Trigger, Principal, and Settings
$action = New-ScheduledTaskAction -Execute $programExe -Argument $arguments -WorkingDirectory $appDir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType S4U -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew

# Unregister any existing task with the same name
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

# Register the new Task
Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Starts the HawHost self-hosted web server engine at boot and keeps it running." -Force | Out-Null

# Start the task immediately
Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

# Verify status
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Host ""
    Write-Host "[SUCCESS] HawHost Automatic Startup Service is INSTALLED and ACTIVE!" -ForegroundColor Green
    Write-Host "Task Name : $taskName" -ForegroundColor Gray
    Write-Host "State     : $($task.State)" -ForegroundColor Gray
    Write-Host "Trigger   : At System Startup (pre-logon, 24/7 uptime)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Your websites and Dynamic DNS will now start automatically whenever your PC powers on." -ForegroundColor White
} else {
    Write-Host "[ERROR] Failed to register Scheduled Task." -ForegroundColor Red
}

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
