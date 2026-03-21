/**
 * suiteDFIR Electron Application Entry Point
 * 
 * This is the main orchestrator that coordinates all modules.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const backend = require('./backend');
const protocol = require('./protocol');
const logger = require('./logger');

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

app.whenReady().then(async () => {
  logger.info('app.whenReady callback fired');

  try {
    // Register protocol handler for production
    protocol.registerHandler();

    // Initialize logger
    logger.info('Calling logger.init()...');
    const logPath = logger.init();
    logger.info('Logger initialized, log file:', logPath);
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
