@echo off
REM Request Administrator privileges
NET SESSION >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

set "SCRIPT_DIR=%~dp0"
set "HANDLER_SCRIPT=%SCRIPT_DIR%UblockDNS-ProtocolHandler.ps1"

REM Register the custom URL protocol in the Windows Registry
REG ADD "HKCR\ublockdns" /ve /t REG_SZ /d "URL:UblockDNS Protocol" /f
REG ADD "HKCR\ublockdns" /v "URL Protocol" /t REG_SZ /d "" /f
REG ADD "HKCR\ublockdns\shell\open\command" /ve /t REG_SZ /d "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%HANDLER_SCRIPT%\" \"%%1\"" /f

echo UblockDNS Protocol Handler successfully registered!
echo You can now click "ENABLE" or "DISABLE" in the Chrome Web UI.
pause
