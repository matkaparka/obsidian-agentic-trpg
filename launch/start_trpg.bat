@echo off
setlocal EnableExtensions EnableDelayedExpansion
title trpg-table

rem Keep loopback requests off any proxy.
set "NO_PROXY=127.0.0.1,localhost"
set "no_proxy=127.0.0.1,localhost"

rem cd with the full path: relative names can be blocked by NoDefaultCurrentDirectoryInExePath.
cd /d "%~dp0..\trpg-table"
if errorlevel 1 (
  echo [trpg] project folder not found: %~dp0..\trpg-table
  pause
  exit /b 1
)

if not exist "dist\main.js" (
  echo [trpg] dist\main.js missing, building...
  call npm run build
  if errorlevel 1 (
    echo [trpg] build failed
    pause
    exit /b 1
  )
)

set "NODE=C:\Program Files\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"

set "ARGS="
:parse
if "%~1"=="" goto run
if /I "%~1"=="dry" (
  set "ARGS=!ARGS! --dry"
) else if /I "%~1"=="nolink" (
  set "ARGS=!ARGS! --nolink"
) else if /I "%~1"=="fake" (
  set "ARGS=!ARGS! --fake"
) else (
  set "ARGS=!ARGS! %~1"
)
shift
goto parse

:run
echo [trpg] node dist\main.js !ARGS!
"%NODE%" dist\main.js !ARGS!
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" (
  echo [trpg] exit code %CODE%. Common causes:
  echo   - port 8098/8099 already used by another game agent
  echo   - missing API keys: copy .env.example to .env and fill it
  echo   - model IDs are still placeholders: edit config\models.yaml
)
pause
exit /b %CODE%
