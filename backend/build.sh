#!/bin/bash
# Build script for suiteDFIR Python backend

set -e

echo "Building suiteDFIR backend for production..."

# Activate venv
source venv/bin/activate

# Install PyInstaller if not already installed
pip install pyinstaller

# Clean previous builds
rm -rf build dist

# Build with PyInstaller
pyinstaller suitedfir-backend.spec

echo "✅ Backend build complete!"
echo "Executable location: backend/dist/suiteDFIR Backend/suitedfir-backend"
