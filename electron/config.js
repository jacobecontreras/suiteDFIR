/**
 * Configuration constants for suiteDFIR Electron App
 */

const path = require('path');
const isDev = require('electron-is-dev');

/**
 * Get and validate the development backend port from environment variable.
 * Falls back to 8000 if invalid or not specified.
 * @returns {number} Valid port number between 1 and 65535
 */
function getValidDevPort() {
    const envPort = process.env.SUITEDFIR_DEV_PORT;

    // If not set, use default
    if (!envPort) {
        return 8000;
    }

    // Validate: must be numeric string only (no "8000abc" allowed)
    if (!/^\d+$/.test(envPort)) {
        console.warn(`Invalid SUITEDFIR_DEV_PORT: "${envPort}". Must be numeric. Using default 8000.`);
        return 8000;
    }

    const port = Number(envPort);

    // Validate: must be in valid port range
    if (port < 1 || port > 65535) {
        console.warn(`Invalid SUITEDFIR_DEV_PORT: "${envPort}". Must be between 1 and 65535. Using default 8000.`);
        return 8000;
    }

    return port;
}

// Backend configuration - dynamic port allocation
const BACKEND_PREFERRED_PORT = 8000;
const BACKEND_PORT_RANGE = [8000, 8100]; // Range to search for available port
const BACKEND_DEV_PORT = getValidDevPort();

// Python executable path
// In production, use bundled executable; in development, use venv Python
const PYTHON_PATH = (() => {
    if (process.platform === 'win32') {
        return isDev
            ? path.join(__dirname, '../backend/venv/Scripts/python.exe')
            : path.join(process.resourcesPath, 'suiteDFIR Backend', 'suitedfir-backend.exe');
    }
    return isDev
        ? path.join(__dirname, '../backend/venv/bin/python')
        : path.join(process.resourcesPath, 'suiteDFIR Backend', 'suitedfir-backend');
})();

// Frontend URL
// In production, use custom app:// protocol; in development, use Vite dev server
const FRONTEND_URL = isDev
    ? 'http://localhost:3000'
    : 'app://./index.html';

// Health check configuration (URL built dynamically with allocated port)
const MAX_HEALTH_CHECK_RETRIES = 30;
const HEALTH_CHECK_INTERVAL = 1000; // 1 second
const HEALTH_CHECK_TIMEOUT = 5000;  // 5 seconds per request

// Zoom limits (75% - 125%)
const ZOOM_LIMITS = {
    MIN: -1.58,  // ~75%
    MAX: 1.22    // ~125%
};

// Window dimensions
const SPLASH_WINDOW = {
    width: 400,
    height: 200
};

const MAIN_WINDOW = {
    width: 1400,
    height: 900
};

module.exports = {
    isDev,
    BACKEND_PREFERRED_PORT,
    BACKEND_PORT_RANGE,
    BACKEND_DEV_PORT,
    PYTHON_PATH,
    FRONTEND_URL,
    MAX_HEALTH_CHECK_RETRIES,
    HEALTH_CHECK_INTERVAL,
    HEALTH_CHECK_TIMEOUT,
    ZOOM_LIMITS,
    SPLASH_WINDOW,
    MAIN_WINDOW
};
