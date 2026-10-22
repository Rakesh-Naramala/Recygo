@echo off
title Push RECYGO to GitHub
cd /d "%~dp0"
echo ======================================================
echo          Push RECYGO Code to GitHub
echo ======================================================
echo.
echo Make sure you have created an empty repository on GitHub first:
echo https://github.com/new
echo.
set /p REPO_URL="Paste your GitHub Repository URL (e.g. https://github.com/username/recygo.git): "

if "%REPO_URL%"=="" (
    echo Error: No repository URL provided!
    pause
    exit /b
)

echo.
echo Linking repository and pushing to main branch...
git branch -M main
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%
git push -u origin main

echo.
echo ======================================================
echo If you see success above, your code is now on GitHub!
echo Now paste that link into Render to deploy.
echo ======================================================
pause
