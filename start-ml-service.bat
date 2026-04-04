@echo off
REM Startup script for the Deepfake Detection ML Service
REM This service analyzes video frames for real/fake detection

echo ==========================================
echo Starting Deepfake ML Service
echo ==========================================

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    exit /b 1
)

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
set ML_MODEL_DIR=%SCRIPT_DIR%ML_model

cd /d "%ML_MODEL_DIR%"

REM Check if virtual environment exists, if not create it
if not exist venv (
    echo Creating Python virtual environment...
    python -m venv venv
)

REM Activate virtual environment
call venv\Scripts\activate.bat

REM Install/update dependencies
echo Installing dependencies...
pip install -q flask numpy opencv-python mediapipe scikit-learn pandas tensorflow keras xgboost joblib ultralytics

REM Start the ML service
echo.
echo ==========================================
echo ML Service starting on http://localhost:5001
echo ==========================================
python ml_service.py

REM Deactivate on exit
call venv\Scripts\deactivate.bat
