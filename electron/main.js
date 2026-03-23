/**
 * suiteDFIR Electron Application Entry Point
 * 
 * This is the main orchestrator that coordinates all modules.
 */

const { app, BrowserWindow, ipcMain, session } = require('electron');
const backend = require('./backend');
const protocol = require('./protocol');
const logger = require('./logger');

const OSM_USER_AGENT = 'suiteDFIR/1.0 (+https://github.com/jacobcontreras/suiteDFIR)';

// IPC handler for frontend to get dynamic backend URL
ipcMain.handle('get-backend-url', () => {
  return backend.getBackendUrl();
});

// Prevent EBADF and other errors from showing dialogs
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error.message);
  logger.error('Stack:', error.stack);
});

// Robust Linux stability fixes
if (process.platform === 'linux') {
  app.disableHardwareAcceleration();

  // Suppress stdout/stderr to prevent EBADF errors from native modules
  try {
    const noop = () => { };
    process.stdout.write = noop;
    process.stderr.write = noop;
  } catch (e) {
    // Ignore
  }
}

// Log startup information
logger.info('main.js module starting');
logger.info('app.isPackaged:', app.isPackaged);

// Register custom protocol scheme before app is ready
protocol.registerScheme();

logger.info('Setting up app.whenReady...');

function configureOsmRequestHeaders() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const url = new URL(details.url);
      const hostname = url.hostname.toLowerCase();
      const isOsmHost =
        hostname === 'tile.openstreetmap.org' ||
        hostname === 'nominatim.openstreetmap.org' ||
        hostname.endsWith('.openstreetmap.org');

      if (isOsmHost) {
        details.requestHeaders['User-Agent'] = OSM_USER_AGENT;
      }
    } catch (error) {
      logger.warn('Failed to inspect outbound request URL:', error.message);
    }

    callback({ requestHeaders: details.requestHeaders });
  });
}

app.whenReady().then(async () => {
  logger.info('app.whenReady callback fired');

  try {
    // Register protocol handler for production
    protocol.registerHandler();

    // Initialize logger
    logger.info('Calling logger.init()...');
    const logPath = logger.init();
    logger.info('Logger initialized, log file:', logPath);
    configureOsmRequestHeaders();
    logger.info('App is ready, starting backend...');

    // Start backend (handles splash, health checks, and main window creation)
    const success = await backend.start();

    if (!success) {
      logger.error('Backend failed to start, quitting app');
      app.quit();
      return;
    }

    // macOS: Re-create window when dock icon is clicked
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const windows = require('./windows');
        windows.createMainWindow();
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

// App lifecycle handlers
app.on('window-all-closed', async () => {
  logger.info('All windows closed');
  if (process.platform !== 'darwin') {
    await backend.stop();
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  logger.info('Before quit event');
  if (backend.isRunning()) {
    e.preventDefault();
    await backend.stop();
    app.quit();
  }
  logger.close();
});

// Signal handlers for cleanup
process.on('SIGINT', async () => {
  logger.info('SIGINT received');
  await backend.stop();
  app.quit();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received');
  await backend.stop();
  app.quit();
  process.exit(0);
});
