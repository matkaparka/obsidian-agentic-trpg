@echo off
setlocal EnableExtensions
title obsidian-trpg

rem Obsidian for the trpg-table stream capture (campaign vault, separate profile).
rem Chromium switches keep the main window rendering while it is covered by another
rem window or minimized. Atlas mirrors the player window from the main renderer's
rem beforeRender callback, so a throttled main window freezes the stream picture.
rem   CalculateNativeWinOcclusion   : Windows native occlusion detection
rem   renderer-backgrounding         : renderer process priority when hidden
rem   background-timer-throttling    : 1 Hz timers when hidden
rem   backgrounding-occluded-windows : occluded window render throttling

if not defined OBSIDIAN_EXE set "OBSIDIAN_EXE=%LOCALAPPDATA%\Obsidian\Obsidian.exe"
set "OBS=%OBSIDIAN_EXE%"
set "PROFILE=%~dp0..\obsidian-data-campaign"
set "FLAGS=--disable-features=CalculateNativeWinOcclusion --disable-renderer-backgrounding --disable-background-timer-throttling --disable-backgrounding-occluded-windows"

set "DEBUG="
if /I "%~1"=="debug" set "DEBUG=--remote-debugging-port=9222"

if not exist "%OBS%" (
  echo [obsidian-trpg] not found: %OBS%
  pause
  exit /b 1
)

start "obsidian-trpg" "%OBS%" --user-data-dir="%PROFILE%" %DEBUG% %FLAGS%
exit /b 0