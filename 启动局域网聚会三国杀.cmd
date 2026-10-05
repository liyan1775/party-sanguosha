@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" -Action Start -Lan
if errorlevel 1 pause
popd
