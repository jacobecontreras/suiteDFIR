#!/bin/bash

# suiteDFIR Production Build Script for macOS
# This script builds the complete production bundle including:
# - Python backend executable
# - Vite static frontend build
# - Electron app bundle
# - DMG distributable

# Set project root relative to script location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$PROJECT_ROOT"

echo "Building suiteDFIR for macOS..."

# Step 1: Build Python backend
echo ""
echo "Building Python backend..."
cd backend
source venv/bin/activate
rm -rf build dist
pyinstaller suitedfir-backend.spec
cd "$PROJECT_ROOT"
echo "Backend built"

# Step 2: Build Frontend
echo ""
echo "Building frontend..."
cd frontend
yarn run build
cd "$PROJECT_ROOT"
echo "Frontend built"

# Step 3: Package Electron App
echo ""
echo "Packaging Electron app..."
cd electron
rm -rf out dist
yarn install
yarn electron-builder --dir --mac

# Copy resources manually (extraResource doesn't work reliably)
APP_PATH="out/mac-arm64/suiteDFIR.app"
RESOURCES_PATH="$APP_PATH/Contents/Resources"

echo "  Copying Python backend..."
cp -R ../backend/dist/suiteDFIR\ Backend "$RESOURCES_PATH/"

echo "  Copying helper binaries (macOS only)..."
mkdir -p "$RESOURCES_PATH/bin"
cp -R ../backend/bin/macos/* "$RESOURCES_PATH/bin/"

echo "  Signing binaries for portability..."
codesign --force --deep --sign - "$RESOURCES_PATH/bin/"*

echo "  Copying forensic-tools..."
mkdir -p "$RESOURCES_PATH/forensic-tools"
cp -R ../backend/forensic-tools "$RESOURCES_PATH/"


echo "  Copying frontend..."
cp -R ../frontend/dist "$RESOURCES_PATH/"

echo "  Creating reports directory..."
mkdir -p "$RESOURCES_PATH/reports"

echo "Electron app packaged"

# Step 4: Create DMG
echo ""
echo "Creating DMG distributable..."
yarn electron-builder --mac dmg --prepackaged "$APP_PATH"
echo "DMG created"

# Done
echo ""
echo "Build complete"
echo ""
echo "Output files:"
echo "  - Electron .app: electron/out/mac-arm64/suiteDFIR.app"
echo "  - DMG Installer: electron/out/"
