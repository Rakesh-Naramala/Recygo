@echo off
title RECYGO Live Public Tunnel
cd /d "%~dp0"
echo ======================================================
echo    Launching RECYGO Live Public HTTPS Link
echo ======================================================
echo.
echo 1. Ensuring local server is running on port 5000...
start /b node server.js
timeout /t 3 >nul
echo 2. Generating public HTTPS link via localtunnel...
echo.
cmd /c npx -y localtunnel --port 5000
pause
