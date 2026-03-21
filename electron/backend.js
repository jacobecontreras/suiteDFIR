/**
 * Python backend process management for suiteDFIR Electron App
 * 
 * Handles starting, stopping, and health checking the Python backend.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const windows = require('./windows');

let pythonProcess = null;
let allocatedPort = null;

/**
 * Get the allocated backend port
 * @returns {number|null}
 */
function getBackendPort() {
    return allocatedPort;
}

/**
 * Get the full backend URL
 * @returns {string|null}
 */
function getBackendUrl() {
    return allocatedPort ? `http://localhost:${allocatedPort}` : null;
}

/**
 * Check if backend is healthy via HTTP health endpoint
 * @returns {Promise<boolean>}
 */
async function checkHealth() {
    if (!allocatedPort) {
        logger.debug('Health check skipped - no port allocated yet');
        return false;
    }

    const healthUrl = `http://127.0.0.1:${allocatedPort}/api/health`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.HEALTH_CHECK_TIMEOUT);

        const response = await fetch(healthUrl, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const data = await response.json();
            return data.status === 'healthy';
        }

        logger.warn(`Health check failed: HTTP ${response.status}`);
        return false;
    } catch (error) {
        if (error.name === 'AbortError') {
            logger.debug('Health check timeout');
        } else {
            logger.debug('Health check error:', error.message);
        }
        return false;
    }
}

/**
 * Wait for backend to become healthy with retries
 * @returns {Promise<boolean>}
 */
async function waitForBackend() {
    logger.info('Starting backend health checks...');

    for (let attempt = 1; attempt <= config.MAX_HEALTH_CHECK_RETRIES; attempt++) {
        const isHealthy = await checkHealth();

        if (isHealthy) {
            logger.info('Backend is healthy!');
            windows.updateSplashStatus('Ready');
            return true;
        }

        windows.updateSplashStatus('Initializing...', attempt, config.MAX_HEALTH_CHECK_RETRIES);
        logger.debug(`Health check attempt ${attempt}/${config.MAX_HEALTH_CHECK_RETRIES} - waiting...`);

        await new Promise(resolve => setTimeout(resolve, config.HEALTH_CHECK_INTERVAL));
    }

    logger.error('Backend health check failed after all retries');
    return false;
}

/**
 * Continue waiting for backend indefinitely (after user chooses "Keep Waiting")
 * @param {number} maxWaitTime - Maximum time to wait in ms (default: 5 minutes)
 * @returns {Promise<boolean>}
 */
async function continueWaitingForBackend(maxWaitTime = 300000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, config.HEALTH_CHECK_INTERVAL));

        const isHealthy = await checkHealth();
        if (isHealthy) {
            logger.info('Backend is now ready!');
            windows.closeSplashWindow();
            windows.createMainWindow();
            return true;
        }

        logger.debug('Still waiting for backend...');
    }

    logger.error('Backend failed to start within maximum wait time');
    return false;
}

/**
 * Log diagnostic information about the backend executable
 */
function logBackendDiagnostics() {
    logger.info('=== Starting Python Backend ===');
    logger.info('Is dev mode:', config.isDev);
    logger.info('Platform:', process.platform, process.arch);
    logger.info('Resources path:', process.resourcesPath || 'N/A');
    logger.info('Backend executable path:', config.PYTHON_PATH);

    const execExists = fs.existsSync(config.PYTHON_PATH);
    logger.info('Backend executable exists:', execExists);

    if (!execExists) {
        logger.error('CRITICAL: Backend executable not found at:', config.PYTHON_PATH);

        // List Resources directory contents for debugging
        if (!config.isDev && process.resourcesPath) {
            try {
                const resourceContents = fs.readdirSync(process.resourcesPath);
                logger.info('Contents of Resources directory:', resourceContents);

                const backendDir = path.join(process.resourcesPath, 'suiteDFIR Backend');
                if (fs.existsSync(backendDir)) {
                    const backendContents = fs.readdirSync(backendDir);
                    logger.info('Contents of suiteDFIR Backend directory:', backendContents);
                } else {
                    logger.error('suiteDFIR Backend directory does not exist');
                }
            } catch (e) {
                logger.error('Failed to list directory contents:', e.message);
            }
        }
        return false;
    }

    // Log file stats
    try {
        const stats = fs.statSync(config.PYTHON_PATH);
        logger.info('Executable stats:', {
            size: stats.size,
            mode: stats.mode.toString(8),
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory()
        });
    } catch (e) {
        logger.error('Failed to stat executable:', e.message);
    }

    return true;
}

/**
 * Start the Python backend process
 * @returns {Promise<boolean>} true if backend started successfully
 */
async function start() {
    const executableExists = logBackendDiagnostics();

    // Show splash screen
    windows.createSplashWindow();
    windows.updateSplashStatus('Starting application...');

    if (!executableExists) {
        windows.updateSplashStatus('Failed to start application');
        return false;
    }

    // Use Port 0 (dynamic allocation by backend)
    // We will parse the port from the backend's stdout
    allocatedPort = null;

    // Build spawn arguments
    let cmd = config.PYTHON_PATH;
    let args = [];
    let cwd = undefined;

    if (config.isDev) {
        // Dev: pass port 0, backend will self-assign
        args = ['-m', 'src.main', '--port', '0'];
        cwd = path.join(__dirname, '../backend');
        logger.info('Dev mode - running uvicorn with dynamic port');
    } else {
        // Production: pass port 0, backend will self-assign
        args = ['--port', '0'];
        logger.info('Production mode - running bundled executable with dynamic port');
    }

    logger.info('Spawn command:', cmd);
    logger.info('Spawn args:', args);
    logger.info('Spawn cwd:', cwd || 'undefined');

    try {
        pythonProcess = spawn(cmd, args, {
            cwd,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        logger.info('Backend process spawned with PID:', pythonProcess.pid);

        // Listen for the magic port string
        pythonProcess.stdout.on('data', (data) => {
            const output = data.toString();
            logger.debug(`[Backend stdout]: ${output.trim()}`);

            const match = output.match(/SUITEDFIR_BACKEND_PORT:(\d+)/);
            if (match && !allocatedPort) {
                allocatedPort = parseInt(match[1], 10);
                logger.info('Captured backend port:', allocatedPort);
            }
        });

        pythonProcess.stderr.on('data', (data) => {
            logger.warn(`[Backend stderr]: ${data.toString().trim()}`);
        });

        pythonProcess.on('error', (error) => {
            logger.error('Failed to start backend process:', error.message);
            logger.error('Error code:', error.code);
            windows.updateSplashStatus('Failed to start application');
        });

        pythonProcess.on('close', (code, signal) => {
            logger.info(`Backend process exited with code ${code}, signal ${signal}`);
        });

        pythonProcess.on('exit', (code, signal) => {
            logger.info(`Backend process exit event: code=${code}, signal=${signal}`);
        });
    } catch (error) {
        logger.error('Exception spawning backend:', error.message);
        logger.error('Stack:', error.stack);
        windows.updateSplashStatus('Failed to start application');
        return false;
    }

    // Wait for the port to be captured
    let portCaptureAttempts = 0;
    while (!allocatedPort && portCaptureAttempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 500));
        portCaptureAttempts++;
    }

    if (!allocatedPort) {
        logger.error('Failed to capture backend port from stdout');
        windows.updateSplashStatus('Failed to connect to backend');
        return false;
    }

    // Wait for backend to be healthy
    const isHealthy = await waitForBackend();

    if (isHealthy) {
        logger.info('Backend is ready, starting frontend...');
        windows.closeSplashWindow();
        windows.createMainWindow();
        return true;
    }

    // Health check failed - show error dialog
    logger.warn('Backend health check failed, showing dialog');
    windows.updateSplashStatus('Taking longer than expected...');

    const shouldKeepWaiting = await windows.showBackendErrorDialog();

    if (shouldKeepWaiting) {
        logger.info('User chose to keep waiting');
        windows.updateSplashStatus('Continuing to initialize...');
        continueWaitingForBackend();
        return true; // Don't block app lifecycle
    }

    // User chose to quit
    logger.info('User chose to quit');
    windows.closeSplashWindow();
    return false;
}

/**
 * Stop the Python backend process
 */
async function stop() {
    if (!pythonProcess) {
        return;
    }

    logger.info('Stopping Python backend...');

    try {
        // Try graceful shutdown via API first
        await fetch(`http://localhost:${allocatedPort}/api/shutdown`, { method: 'POST' });
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (pythonProcess) {
            pythonProcess.kill('SIGTERM');
        }
    } catch (error) {
        logger.warn('Graceful shutdown failed, forcing kill...');
        if (pythonProcess) {
            pythonProcess.kill('SIGTERM');
        }
    }

    pythonProcess = null;
}

/**
 * Check if backend process is running
 */
function isRunning() {
    return pythonProcess !== null;
}

module.exports = {
    start,
    stop,
    isRunning,
    checkHealth,
    getBackendPort,
    getBackendUrl
};
