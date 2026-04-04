#!/bin/bash
# Startup script for the Deepfake Detection ML Service
# This service analyzes video frames for real/fake detection

echo "=========================================="
echo "Starting Deepfake ML Service"
echo "=========================================="

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python3 is not installed"
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ML_MODEL_DIR="$SCRIPT_DIR/ML_model"

cd "$ML_MODEL_DIR"

# Check if virtual environment exists, if not create it
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install/update dependencies
echo "Installing dependencies..."
pip install -q flask numpy opencv-python mediapipe scikit-learn pandas tensorflow keras xgboost joblib ultralytics

# Start the ML service
echo ""
echo "=========================================="
echo "ML Service starting on http://localhost:5001"
echo "=========================================="
python ml_service.py

# Deactivate on exit
deactivate
