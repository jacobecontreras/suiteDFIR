@echo off
setlocal EnableDelayedExpansion

echo ==========================================
echo   suiteDFIR Production Build (Windows)
echo ==========================================

REM --- Configuration ---
set "BACKEND_DIR=%~dp0..\backend"
set "FRONTEND_DIR=%~dp0..\frontend"
set "ELECTRON_DIR=%~dp0..\electron"
set "BUILD_DIR=%ELECTRON_DIR%\out"

REM Check for Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python.
    exit /b 1
)

REM --- Step 1: Build Python Backend ---
echo.
echo [1/5] Building Python Backend...
cd "%BACKEND_DIR%"

if not exist venv (
    echo   Creating virtual environment...
    python -m venv venv
)

echo   Activating venv...
call venv\Scripts\activate

echo   Installing requirements...
pip install -r requirements.txt
pip install pyinstaller

echo   Running PyInstaller...
if exist build rd /s /q build
if exist dist rd /s /q dist
pyinstaller suitedfir-backend.spec

echo   Checking if backend executable exists...
if not exist "dist\suiteDFIR Backend\suitedfir-backend.exe" (
    echo [ERROR] Backend build likely failed. Executable not found at "dist\suiteDFIR Backend\suitedfir-backend.exe".
    exit /b 1
)
echo   Backend built successfully.

REM --- Step 2: Build Frontend ---
echo.
echo [2/5] Building Frontend (Static Export)...
cd "%FRONTEND_DIR%"
call yarn install
call yarn run build

if not exist dist (
    echo [ERROR] Frontend build failed. 'dist' directory not found.
    exit /b 1
)
echo   Frontend built successfully.

REM --- Step 3: Package Electron App ---
echo.
echo [3/5] Packaging Electron App...
cd "%ELECTRON_DIR%"
if exist out rd /s /q out
if exist dist rd /s /q dist
call yarn install
call yarn electron-builder --dir --win

REM Find the output directory (handling version/arch variations)
set "APP_ROOT=%ELECTRON_DIR%\out\win-unpacked"

if not defined APP_ROOT (
    echo [ERROR] Electron package failed. Output directory not found.
    exit /b 1
)
echo   Electron packaged to: %APP_ROOT%

REM --- Step 4: Copy Resources ---
echo.
echo [4/5] Copying Resources...

set "RESOURCES_PATH=%APP_ROOT%\resources"

echo   Copying Backend...
if not exist "%RESOURCES_PATH%\suiteDFIR Backend" mkdir "%RESOURCES_PATH%\suiteDFIR Backend"
xcopy /E /I /Y /Q "%BACKEND_DIR%\dist\suiteDFIR Backend" "%RESOURCES_PATH%\suiteDFIR Backend"

echo   Copying Frontend...
if not exist "%RESOURCES_PATH%\dist" mkdir "%RESOURCES_PATH%\dist"
xcopy /E /I /Y /Q "%FRONTEND_DIR%\dist" "%RESOURCES_PATH%\dist"

echo   Copying Binaries...
if not exist "%RESOURCES_PATH%\bin" mkdir "%RESOURCES_PATH%\bin"
if exist "%BACKEND_DIR%\bin\windows" (
    xcopy /E /I /Y /Q "%BACKEND_DIR%\bin\windows" "%RESOURCES_PATH%\bin"
) else (
    echo   [WARNING] No Windows binaries found in backend\bin\windows. Please check your source.
)

echo   Copying forensic-tools...
if not exist "%RESOURCES_PATH%\forensic-tools" mkdir "%RESOURCES_PATH%\forensic-tools"
xcopy /E /I /Y /Q "%BACKEND_DIR%\forensic-tools" "%RESOURCES_PATH%\forensic-tools"

echo   Creating reports directory...
if not exist "%RESOURCES_PATH%\reports" mkdir "%RESOURCES_PATH%\reports"

REM --- Step 5: Create Installer (Squirrel) ---
echo.
echo [5/5] Creating Installer...
cd "%ELECTRON_DIR%"
REM Explicitly set platform/arch to avoid "paths[0] undefined" resolution errors
call yarn electron-builder --win nsis --prepackaged "%APP_ROOT%"

echo.
echo ==========================================
echo   Build Complete!
echo ==========================================
echo.
echo Output artifacts should be in: electron\out\
pause
