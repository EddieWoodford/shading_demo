@echo off
rem Start the PV string shading demo (Windows): double-click this file.
rem First run downloads uv (a small Python manager) into .tools. uv then installs
rem Python, only if a suitable one is not installed already, plus the pinned
rem packages. Nothing outside this folder changes: delete the folder to remove it all.
setlocal
cd /d "%~dp0"
title PV string shading demo

set "TOOLS=%~dp0.tools"
set "UV_CACHE_DIR=%TOOLS%\cache"
set "UV_PYTHON_INSTALL_DIR=%TOOLS%\python"

set "UV=uv"
where uv >nul 2>nul
if not errorlevel 1 goto run

set "UV=%TOOLS%\uv.exe"
if exist "%UV%" goto run

echo First run: downloading uv, which sets up Python and the packages...
set "ARCH=x86_64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=aarch64"
set "UV_ZIP=https://github.com/astral-sh/uv/releases/latest/download/uv-%ARCH%-pc-windows-msvc.zip"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ProgressPreference = 'SilentlyContinue'; $ErrorActionPreference = 'Stop';" ^
  "$zip = Join-Path $env:TEMP 'uv-shading-demo.zip';" ^
  "Invoke-WebRequest $env:UV_ZIP -OutFile $zip;" ^
  "Expand-Archive $zip $env:TOOLS -Force; Remove-Item $zip"
if not exist "%UV%" goto fail

:run
echo.
echo Starting the demo. Your browser opens at http://127.0.0.1:5000 when it is ready.
echo The first run takes a minute or two. Close this window to stop the demo.
echo.
"%UV%" run --frozen --no-dev app.py --open
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo Something went wrong - see the messages above.
pause
exit /b 1
