@echo off
title RECYGO Platform Server
cd /d "%~dp0"
echo ======================================================
echo    Starting RECYGO Smart Platform with Admin Access
echo ======================================================
echo.
start "" http://localhost:5000#admin
node server.js
pause
