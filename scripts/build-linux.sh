#!/bin/bash
# Set project root relative to script location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$PROJECT_ROOT"

echo "Building suiteDFIR for Linux..."

# Step 1: Build Python backend
cd backend
source venv/bin/activate
echo "Building Python backend with PyInstaller..."
rm -rf build dist
pyinstaller suitedfir-backend.spec
cd "$PROJECT_ROOT"

# Step 2: Build Frontend
cd frontend
echo "Building frontend..."
yarn run build
cd "$PROJECT_ROOT"

# Step 3: Package Electron App
cd electron
echo "Packaging Electron application..."
rm -rf out dist
yarn install
yarn run electron-builder --dir --linux

# Copy resources manually
APP_PATH="out/linux-unpacked"
RESOURCES_PATH="$APP_PATH/resources"

echo "Copying resources to Electron app..."

# Copy Python backend
mkdir -p "$RESOURCES_PATH"
cp -R ../backend/dist/suiteDFIR\ Backend "$RESOURCES_PATH/"

# Copy iOS device binaries (Linux-specific)
mkdir -p "$RESOURCES_PATH/bin"
cp -R ../backend/bin/linux/* "$RESOURCES_PATH/bin/"

# Copy forensic tools
mkdir -p "$RESOURCES_PATH/forensic-tools"
cp -R ../backend/forensic-tools "$RESOURCES_PATH/"

# Copy frontend static files
cp -R ../frontend/dist "$RESOURCES_PATH/"

# Create reports directory
mkdir -p "$RESOURCES_PATH/reports"

echo "Creating AppImage..."
# Step 4: Create AppImage
yarn run electron-builder --linux AppImage --prepackaged "$APP_PATH"

echo "Build complete! AppImage should be in electron/out/"
