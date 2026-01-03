const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const isDev = require('electron-is-dev');
const logger = require('./logger');

// Prevent EBADF and other errors from showing dialogs
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error.message);
  logger.error('Stack:', error.stack);
});

// Robust Linux stability fixes
if (process.platform === 'linux') {
  // Disable GPU acceleration to prevent rendering crashes
  app.disableHardwareAcceleration();

  // Suppress all writes to stdout/stderr to prevent EBADF errors from native modules or Electron internals
  // This is a nuclear option but necessary if the streams are closed/invalid
  try {
    const noop = () => { };
    process.stdout.write = noop;
    process.stderr.write = noop;
  } catch (e) {
    // Ignore
  }
}


// Immediate logging to track startup progress
logger.info('main.js module starting - requires completed');
logger.info('isDev:', isDev);
logger.info('app.isPackaged:', app.isPackaged);

let mainWindow;
let pythonProcess;

// Backend configuration
const BACKEND_PORT = 8000;

logger.info('Calculating PYTHON_PATH...');

// In production, use bundled Python executable
// In development, use venv Python
const PYTHON_PATH = process.platform === 'win32'
  ? isDev
    ? path.join(__dirname, '../backend/venv/Scripts/python.exe')
    : path.join(process.resourcesPath, 'VDF Tools Backend', 'vdf-backend.exe')
  : isDev
    ? path.join(__dirname, '../backend/venv/bin/python')
    : path.join(process.resourcesPath, 'VDF Tools Backend', 'vdf-backend');

logger.info('PYTHON_PATH:', PYTHON_PATH);

const BACKEND_FILE = path.join(__dirname, '../backend/main.py');

// In production, use custom app:// protocol for proper static file routing
// In development, load from dev server
const FRONTEND_URL = isDev
  ? 'http://localhost:3000'
  : 'app://./index.html';

logger.info('FRONTEND_URL:', FRONTEND_URL);

// Health check configuration
const HEALTH_CHECK_URL = 'http://127.0.0.1:8000/health';
const MAX_HEALTH_CHECK_RETRIES = 30;
const HEALTH_CHECK_INTERVAL = 1000; // 1 second

logger.info('Module-level initialization complete');

let splashWindow;

function createSplashWindow() {
  logger.info('Creating splash window');
  splashWindow = new BrowserWindow({
    width: 400,
    height: 200,
    center: true,
    frame: false,
    resizable: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  const splashPath = path.join(__dirname, 'splash.html');
  logger.debug('Loading splash from:', splashPath);
  splashWindow.loadFile(splashPath);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function updateSplashStatus(message, attempt = 0, maxAttempts = 0) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('update-status', message);
    if (attempt > 0) {
      splashWindow.webContents.send('update-retry-info', attempt, maxAttempts);
    }
  }
}

async function checkBackendHealth() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(HEALTH_CHECK_URL, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
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

async function waitForBackend() {
  logger.info('Starting backend health checks...');

  for (let attempt = 1; attempt <= MAX_HEALTH_CHECK_RETRIES; attempt++) {
    const isHealthy = await checkBackendHealth();

    if (isHealthy) {
      logger.info('Backend is healthy!');
      updateSplashStatus('Ready');
      return true;
    }

    // Update splash screen with progress
    const statusMsg = 'Initializing...';
    updateSplashStatus(statusMsg, attempt, MAX_HEALTH_CHECK_RETRIES);

    logger.debug(`Health check attempt ${attempt}/${MAX_HEALTH_CHECK_RETRIES} - waiting...`);

    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL));
  }

  logger.error('Backend health check failed after all retries');
  return false;
}

async function showBackendErrorDialog() {
  const { dialog } = require('electron');

  logger.warn('Showing backend error dialog to user');

  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'Backend Not Responding',
    message: 'The backend service is taking longer than expected to start.',
    detail: `This can happen on slower systems or if there are configuration issues.\n\nLog file: ${logger.getLogPath()}`,
    buttons: ['Keep Waiting', 'Quit'],
    defaultId: 0,
    cancelId: 1
  });

  return result.response === 0; // true if user chose "Keep Waiting"
}

function createWindow() {
  logger.info('Creating main window');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: !isDev  // Allow file:// navigation in production
    },
    title: 'VDF Tools',
    show: false
  });

  logger.info('Loading frontend URL:', FRONTEND_URL);
  mainWindow.loadURL(FRONTEND_URL);

  // Harden zoom restrictions (75% - 125%) by intercepting keyboard shortcuts
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.meta || input.control)) {
      const zoomLevel = mainWindow.webContents.getZoomLevel();
      // Limits: 75% factor is approx level -1.58, 125% factor is approx level 1.22
      const MIN_ZOOM = -1.58;
      const MAX_ZOOM = 1.22;

      if (input.key === '=' || input.key === '+') {
        if (zoomLevel >= MAX_ZOOM) {
          event.preventDefault();
          logger.debug('Zoom-in limit reached (125%)');
        }
      } else if (input.key === '-') {
        if (zoomLevel <= MIN_ZOOM) {
          event.preventDefault();
          logger.debug('Zoom-out limit reached (75%)');
        }
      } else if (input.key === '0') {
        // Reset to 100% (level 0) is always allowed
        mainWindow.webContents.setZoomLevel(0);
        event.preventDefault();
        logger.debug('Zoom reset to 100%');
      }
    }
  });

  // Secondary backup to prevent non-keyboard zoom (e.g. Menu items)
  mainWindow.webContents.on('will-zoom-level-change', (event, newZoomLevel) => {
    const MIN_ZOOM = -1.58;
    const MAX_ZOOM = 1.22;
    if (newZoomLevel > MAX_ZOOM || newZoomLevel < MIN_ZOOM) {
      event.preventDefault();
    }
  });

  // Navigation is handled by app:// protocol in production

  mainWindow.once('ready-to-show', () => {
    logger.info('Main window ready to show');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startPythonBackend() {
  logger.info('=== Starting Python Backend ===');
  logger.info('Is dev mode:', isDev);
  logger.info('Platform:', process.platform, process.arch);
  logger.info('Resources path:', process.resourcesPath || 'N/A');

  // Log the computed backend path
  logger.info('Backend executable path:', PYTHON_PATH);

  // Check if executable exists
  const execExists = fs.existsSync(PYTHON_PATH);
  logger.info('Backend executable exists:', execExists);

  if (!execExists) {
    logger.error('CRITICAL: Backend executable not found at:', PYTHON_PATH);

    // List what's actually in the Resources directory
    if (!isDev && process.resourcesPath) {
      try {
        const resourceContents = fs.readdirSync(process.resourcesPath);
        logger.info('Contents of Resources directory:', resourceContents);

        const backendDir = path.join(process.resourcesPath, 'VDF Tools Backend');
        if (fs.existsSync(backendDir)) {
          const backendContents = fs.readdirSync(backendDir);
          logger.info('Contents of VDF Tools Backend directory:', backendContents);
        } else {
          logger.error('VDF Tools Backend directory does not exist');
        }
      } catch (e) {
        logger.error('Failed to list directory contents:', e.message);
      }
    }
  } else {
    // Check file stats
    try {
      const stats = fs.statSync(PYTHON_PATH);
      logger.info('Executable stats:', {
        size: stats.size,
        mode: stats.mode.toString(8),
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory()
      });
    } catch (e) {
      logger.error('Failed to stat executable:', e.message);
    }
  }

  // Show splash screen immediately
  createSplashWindow();
  updateSplashStatus('Starting application...');

  let args, cmd;

  if (isDev) {
    // Development: Run uvicorn with Python interpreter
    cmd = PYTHON_PATH;
    args = ['-m', 'uvicorn', 'main:app', '--host', '0.0.0.0', '--port', BACKEND_PORT.toString()];
    logger.info('Dev mode - running uvicorn');
  } else {
    // Production: Run bundled executable directly
    cmd = PYTHON_PATH;
    args = [];  // Executable has everything bundled
    logger.info('Production mode - running bundled executable');
  }

  logger.info('Spawn command:', cmd);
  logger.info('Spawn args:', args);
  logger.info('Spawn cwd:', isDev ? path.join(__dirname, '../backend') : 'undefined');

  try {
    pythonProcess = spawn(cmd, args, {
      cwd: isDev ? path.join(__dirname, '../backend') : undefined,
      shell: false,  // Changed from true for better reliability
      stdio: ['ignore', 'pipe', 'pipe']
    });

    logger.info('Backend process spawned with PID:', pythonProcess.pid);

    pythonProcess.stdout.on('data', (data) => {
      logger.debug(`[Backend stdout]: ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on('data', (data) => {
      logger.warn(`[Backend stderr]: ${data.toString().trim()}`);
    });

    pythonProcess.on('error', (error) => {
      logger.error('Failed to start backend process:', error.message);
      logger.error('Error code:', error.code);
      updateSplashStatus('Failed to start application');
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
    updateSplashStatus('Failed to start application');
    return;
  }

  // Wait for backend to be healthy using health check
  const isHealthy = await waitForBackend();

  if (isHealthy) {
    // Backend is ready - close splash and create main window
    logger.info('Backend is ready, starting frontend...');
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
    }
    createWindow();
  } else {
    // Health check failed - show error dialog
    logger.warn('Backend health check failed, showing dialog');
    updateSplashStatus('Taking longer than expected...');
    const shouldKeepWaiting = await showBackendErrorDialog();

    if (shouldKeepWaiting) {
      // User chose to keep waiting - continue retrying in background
      logger.info('User chose to keep waiting');
      updateSplashStatus('Continuing to initialize...');
      continueWaitingForBackend();
    } else {
      // User chose to quit
      logger.info('User chose to quit');
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      app.quit();
    }
  }
}

async function continueWaitingForBackend() {
  // Continuously check backend health in background
  while (true) {
    await new Promise(resolve => setTimeout(resolve, HEALTH_CHECK_INTERVAL));

    const isHealthy = await checkBackendHealth();
    if (isHealthy) {
      logger.info('Backend is now ready!');
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      createWindow();
      break;
    }

    logger.debug('Still waiting for backend...');
  }
}

async function stopPythonBackend() {
  if (pythonProcess) {
    logger.info('Stopping Python backend...');

    try {
      // Try graceful shutdown via API first
      await fetch('http://localhost:8000/shutdown', { method: 'POST' });

      // Wait a moment for shutdown to complete
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Force kill if still running
      if (pythonProcess) {
        // Windows doesn't support SIGTERM, use default kill
        if (process.platform === 'win32') {
          pythonProcess.kill();
        } else {
          pythonProcess.kill('SIGTERM');
        }
      }
    } catch (error) {
      // If API call fails, force kill immediately
      logger.warn('Graceful shutdown failed, forcing kill...');
      if (process.platform === 'win32') {
        pythonProcess.kill();
      } else {
        pythonProcess.kill('SIGTERM');
      }
    }

    pythonProcess = null;
  }
}

// App lifecycle
logger.info('Setting up app.whenReady...');

// Register custom protocol scheme before app is ready
if (!isDev) {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ]);
}

app.whenReady().then(() => {
  logger.info('app.whenReady callback fired');

  try {
    // Register custom protocol for production static file serving
    if (!isDev) {
      const outDir = path.join(process.resourcesPath, 'out');
      logger.info('Registering app:// protocol, outDir:', outDir);

      protocol.handle('app', (request) => {
        const url = new URL(request.url);
        let filePath = url.pathname;

        // Remove leading ./ if present (from relative URLs)
        if (filePath.startsWith('./')) {
          filePath = filePath.substring(1);
        }

        // IMPORTANT: _next paths should always resolve from root
        // e.g., "cases/_next/..." should become "_next/..."
        const nextIndex = filePath.indexOf('_next/');
        if (nextIndex > 0) {
          filePath = '/' + filePath.substring(nextIndex);
        }

        // Handle root path
        if (filePath === '/' || filePath === '') {
          filePath = '/index.html';
        }

        // Add index.html for directory paths (but not for files with extensions)
        if (filePath.endsWith('/')) {
          filePath += 'index.html';
        } else if (!path.extname(filePath) && !filePath.includes('_next')) {
          // If no extension and it's a route (not _next asset), add /index.html
          filePath += '/index.html';
        }

        const absolutePath = path.join(outDir, filePath);
        logger.debug('Protocol request:', request.url, '->', absolutePath);

        return require('electron').net.fetch(`file://${absolutePath}`);
      });
    }

    // Initialize logger
    logger.info('Calling logger.init()...');
    const logPath = logger.init();
    logger.info('Logger initialized, log file:', logPath);
    logger.info('App is ready, starting backend...');

    startPythonBackend();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    logger.error('Error in app.whenReady callback:', error.message);
    logger.error('Stack:', error.stack);
  }
}).catch((error) => {
  logger.error('app.whenReady promise rejected:', error.message);
  logger.error('Stack:', error.stack);
});

logger.info('app.whenReady registered, waiting for ready event...');

app.on('window-all-closed', async () => {
  logger.info('All windows closed');
  if (process.platform !== 'darwin') {
    await stopPythonBackend();
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  logger.info('Before quit event');
  if (pythonProcess) {
    e.preventDefault();
    await stopPythonBackend();
    app.quit();
  }
  logger.close();
});

// Handle cleanup on all platforms
process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await stopPythonBackend();
  app.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await stopPythonBackend();
  app.quit();
  process.exit(0);
});

// IPC handlers for renderer process
ipcMain.handle('retry-backend-check', async () => {
  // Trigger another round of health checks
  logger.info('Retry backend check requested');
  updateSplashStatus('Retrying...');
  await continueWaitingForBackend();
});

ipcMain.handle('quit-app', async () => {
  // Gracefully quit the application
  logger.info('Quit app requested');
  await stopPythonBackend();
  app.quit();
});

ipcMain.handle('get-log-path', () => {
  return logger.getLogPath();
});
