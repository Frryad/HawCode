@echo off
setlocal
echo ========================================================
echo   HawHost Web Server - Remove Windows Automatic Startup
echo ========================================================
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0unregister-windows-service.ps1"

set "REG_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "APP_NAME=HawHostWebServer"
reg delete "%REG_KEY%" /v "%APP_NAME%" /f >nul 2>&1
echo [OK] Removed user logon registry entries if present.
echo.
pause
