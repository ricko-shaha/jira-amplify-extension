@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   Jira-Amplify Extension - Updater Setup
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed. Install it from https://nodejs.org
    pause
    exit /b 1
)

:: Check Git
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Git is not installed. Install it from https://git-scm.com
    pause
    exit /b 1
)

echo [1/3] Getting extension ID...
echo.
echo    Open chrome://extensions in Chrome.
echo    Find "Jira-Amplify Timelog Sync" and copy the ID
echo    (the long string of letters under the extension name).
echo.
set /p EXT_ID="   Paste your extension ID: "

if "%EXT_ID%"=="" (
    echo ERROR: No extension ID provided.
    pause
    exit /b 1
)

echo.
echo [2/3] Creating native messaging host manifest...

set HOST_BAT=%~dp0updater\host.bat
set MANIFEST_PATH=%~dp0updater\com.jira_amplify.updater.json

:: Build JSON with proper escaped backslashes
set "ESC_PATH=%HOST_BAT:\=\\%"

> "%MANIFEST_PATH%" (
    echo {
    echo   "name": "com.jira_amplify.updater",
    echo   "description": "Jira-Amplify Extension Auto-Updater",
    echo   "path": "%ESC_PATH%",
    echo   "type": "stdio",
    echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]
    echo }
)

echo    Created: %MANIFEST_PATH%

echo.
echo [3/3] Registering with Chrome...

reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.jira_amplify.updater" /ve /d "%MANIFEST_PATH%" /f >nul 2>&1

echo    Registry entry added.
echo.
echo ============================================
echo   Setup complete!
echo.
echo   You can now update the extension with
echo   one click from the Settings tab.
echo ============================================
echo.
pause
