@echo off
title RECYGO Platform Launcher
cd /d "%~dp0ecoscrap"
echo ======================================================
echo    Launching RECYGO Platform + Admin Control
echo ======================================================
echo.
start "" http://localhost:5000#admin
node server.js
pause
