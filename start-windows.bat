@echo off
rem Start the check-in LAN server on Windows and open the star screen.
cd /d "%~dp0"
where py >nul 2>nul && (py -3 server.py --open & goto done)
python -c "import sys; sys.exit(sys.version_info < (3, 7))" >nul 2>nul && (python server.py --open & goto done)
echo.
echo   Python 3 not found. Install it from https://www.python.org/downloads/
echo   and tick "Add python.exe to PATH" in the installer, then run this file again.
echo.
:done
pause
