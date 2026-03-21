/**
 * Window management for suiteDFIR Electron App
 * 
 * Handles creation and management of main window and splash screen.
 */

const { BrowserWindow, dialog } = require('electron');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

let mainWindow = null;
let splashWindow = null;

/**
 * Create the splash screen window
 */
function createSplashWindow() {
    logger.info('Creating splash window');

    splashWindow = new BrowserWindow({
        width: config.SPLASH_WINDOW.width,
        height: config.SPLASH_WINDOW.height,
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

    return splashWindow;
}

/**
 * Update the splash screen status message
 */
function updateSplashStatus(message, attempt = 0, maxAttempts = 0) {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.webContents.send('update-status', message);
        if (attempt > 0) {
            splashWindow.webContents.send('update-retry-info', attempt, maxAttempts);
        }
    }
}

/**
 * Close the splash window
 */
function closeSplashWindow() {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
    }
}

/**
 * Show error dialog when backend fails to start
 * @returns {Promise<boolean>} true if user chose "Keep Waiting"
 */
async function showBackendErrorDialog() {
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

    return result.response === 0;
}

/**
 * Create the main application window
 */
function createMainWindow() {
    logger.info('Creating main window');

    mainWindow = new BrowserWindow({
        width: config.MAIN_WINDOW.width,
        height: config.MAIN_WINDOW.height,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: !config.isDev
        },
        title: '',
        show: false
    });

    logger.info('Loading frontend URL:', config.FRONTEND_URL);
    mainWindow.loadURL(config.FRONTEND_URL);

    // Zoom limit enforcement via keyboard shortcuts
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && (input.meta || input.control)) {
            const zoomLevel = mainWindow.webContents.getZoomLevel();

            if (input.key === '=' || input.key === '+') {
                if (zoomLevel >= config.ZOOM_LIMITS.MAX) {
                    event.preventDefault();
                    logger.debug('Zoom-in limit reached (125%)');
                }
            } else if (input.key === '-') {
                if (zoomLevel <= config.ZOOM_LIMITS.MIN) {
                    event.preventDefault();
                    logger.debug('Zoom-out limit reached (75%)');
                }
            } else if (input.key === '0') {
                mainWindow.webContents.setZoomLevel(0);
                event.preventDefault();
                logger.debug('Zoom reset to 100%');
            }
        }
    });

    // Backup zoom limit for non-keyboard zoom
    mainWindow.webContents.on('will-zoom-level-change', (event, newZoomLevel) => {
        if (newZoomLevel > config.ZOOM_LIMITS.MAX || newZoomLevel < config.ZOOM_LIMITS.MIN) {
            event.preventDefault();
        }
    });

    mainWindow.once('ready-to-show', () => {
        logger.info('Main window ready to show');
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    return mainWindow;
}

/**
 * Get the main window instance
 */
function getMainWindow() {
    return mainWindow;
}

/**
 * Get the splash window instance
 */
function getSplashWindow() {
    return splashWindow;
}

module.exports = {
    createSplashWindow,
    updateSplashStatus,
    closeSplashWindow,
    showBackendErrorDialog,
    createMainWindow,
    getMainWindow,
    getSplashWindow
};
