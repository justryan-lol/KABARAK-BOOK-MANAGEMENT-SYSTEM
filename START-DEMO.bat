@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  start "KBMS Demo Server" cmd /k py -m http.server 8000 --bind 127.0.0.1
) else (
  start "KBMS Demo Server" cmd /k python -m http.server 8000 --bind 127.0.0.1
)
timeout /t 2 >nul
start "" http://127.0.0.1:8000/
echo.
echo KBMS demo is running. Close the "KBMS Demo Server" window to stop it.
