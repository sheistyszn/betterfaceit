@echo off
title BetterFaceit Uninstaller
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
if %ERRORLEVEL% NEQ 0 (
    echo.
    pause
)
