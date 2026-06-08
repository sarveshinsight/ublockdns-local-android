@echo off
REM Request Administrator privileges if not already granted
NET SESSION >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

REM Run the PowerShell Controller
powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0UblockDNS-Controller.ps1"
