#!/bin/bash
# Set project root relative to script location
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$PROJECT_ROOT"

echo "Building suiteDFIR for Linux..."

# Detect host architecture once; everything downstream depends on it.
# electron-builder names its output dir by target arch: out/linux-unpacked
# for x64 but out/linux-arm64-unpacked for arm64 — if APP_PATH doesn't match,
# resources get copied into an orphan directory and the AppImage is packaged
# without the app.
HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
    x86_64|amd64)
        BIN_ARCH="x86_64"
        EB_ARCH_FLAG="--x64"
        UNPACKED_DIR="linux-unpacked"
        ;;
    aarch64|arm64)
        BIN_ARCH="arm64"
        EB_ARCH_FLAG="--arm64"
        UNPACKED_DIR="linux-arm64-unpacked"
        ;;
    *) echo "ERROR: unsupported build architecture: $HOST_ARCH" >&2; exit 1 ;;
esac
echo "Host architecture: $HOST_ARCH (electron-builder $EB_ARCH_FLAG, bin/linux/$BIN_ARCH)"

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
yarn run electron-builder --dir --linux "$EB_ARCH_FLAG"

# Copy resources manually
APP_PATH="out/$UNPACKED_DIR"
RESOURCES_PATH="$APP_PATH/resources"

# Guard: the unpacked app must exist where we're about to copy resources,
# otherwise the AppImage step silently packages a directory without the app.
if [ ! -x "$APP_PATH/suitedfir-app" ]; then
    echo "ERROR: $APP_PATH/suitedfir-app not found — electron-builder output dir mismatch" >&2
    exit 1
fi

echo "Copying resources to Electron app..."

# Copy Python backend
mkdir -p "$RESOURCES_PATH"
cp -R ../backend/dist/suiteDFIR\ Backend "$RESOURCES_PATH/"

# Copy iOS device binaries (Linux-specific, split by architecture).
# Keep the linux/<arch>/ structure: get_binary_path() searches bin/linux/<arch>/<name>.
mkdir -p "$RESOURCES_PATH/bin/linux/$BIN_ARCH"
cp -R "../backend/bin/linux/$BIN_ARCH/." "$RESOURCES_PATH/bin/linux/$BIN_ARCH/"

# Copy forensic tools
mkdir -p "$RESOURCES_PATH/forensic-tools"
cp -R ../backend/forensic-tools "$RESOURCES_PATH/"

# Copy frontend static files
cp -R ../frontend/dist "$RESOURCES_PATH/"

# Create reports directory
mkdir -p "$RESOURCES_PATH/reports"

echo "Creating AppImage and deb..."
# Step 4: Package installers from the prepackaged dir.
# deb is the preferred install format: its postinst sets chrome-sandbox to
# root:4755 so the Electron sandbox works on Ubuntu 24.04+ (which blocks the
# userns sandbox AppImages rely on).
yarn run electron-builder --linux AppImage deb "$EB_ARCH_FLAG" --prepackaged "$APP_PATH"

echo "Build complete! AppImage and .deb should be in electron/out/"
