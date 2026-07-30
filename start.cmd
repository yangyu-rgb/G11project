@echo off
setlocal
cd /d "%~dp0"

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: Windows PowerShell was not found.
  echo Run start.ps1 from PowerShell 5.1 or later.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
set "PROJECT_EXIT_CODE=%ERRORLEVEL%"

if not "%PROJECT_EXIT_CODE%"=="0" (
  echo.
  echo Startup failed with exit code %PROJECT_EXIT_CODE%.
  pause
)

exit /b %PROJECT_EXIT_CODE%
