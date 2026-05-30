@echo off
cd /d "%~dp0"

echo =================================
echo   MemoApp Build
echo =================================
echo.

echo [1/2] npm install...
call npm install
if errorlevel 1 (
    echo.
    echo ERROR: npm install failed
    pause
    exit /b 1
)

echo.
echo [2/2] Building MemoApp.exe...
call npm run build
if errorlevel 1 (
    echo.
    echo ERROR: build failed
    pause
    exit /b 1
)

echo.
echo =================================
echo   Done! dist\MemoApp.exe created
echo =================================
pause
