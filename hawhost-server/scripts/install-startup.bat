@echo off
setlocal
echo ========================================================
echo   HawHost Web Server - Windows Startup Configuration
echo ========================================================
echo.
echo Choose automatic startup mode:
echo   [1] Full Windows Service (Runs at Boot before logon - Recommended)
echo   [2] User Logon Item (Runs when you sign in to Windows)
echo.
set /p choice="Enter choice [1 or 2, default=1]: "

if "%choice%"=="2" goto LOGON_ITEM

:SERVICE_ITEM
echo.
echo Launching Windows Scheduled Task installer with administrator elevation...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-windows-service.ps1"
goto END

:LOGON_ITEM
echo.
set "APP_DIR=%~dp0.."
set "REG_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "APP_NAME=HawHostWebServer"

reg add "%REG_KEY%" /v "%APP_NAME%" /t REG_SZ /d "\"%COMSPEC%\" /c \"cd /d \"%APP_DIR%\" && npm start\"" /f
if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] HawHost configured to start on user login.
) else (
    echo.
    echo [ERROR] Failed to add registry key.
)
pause

:END
