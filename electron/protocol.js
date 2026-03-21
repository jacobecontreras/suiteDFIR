/**
 * Custom app:// protocol for suiteDFIR Electron App
 * 
 * Handles static file serving in production builds.
 */

const { protocol, net } = require('electron');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

/**
 * Register the custom scheme before app is ready
 * Must be called before app.whenReady()
 */
function registerScheme() {
    if (!config.isDev) {
        protocol.registerSchemesAsPrivileged([
            { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
        ]);
    }
}

/**
 * Register the protocol handler after app is ready
 * Must be called inside app.whenReady()
 */
function registerHandler() {
    if (config.isDev) {
        return; // No custom protocol in dev mode
    }

    const distDir = path.join(process.resourcesPath, 'dist');
    logger.info('Registering app:// protocol, distDir:', distDir);

    protocol.handle('app', (request) => {
        const url = new URL(request.url);
        let filePath = url.pathname;

        // Remove leading ./ if present (from relative URLs)
        if (filePath.startsWith('./')) {
            filePath = filePath.substring(1);
        }

        // Handle root path
        if (filePath === '/' || filePath === '') {
            filePath = '/index.html';
        }

        // For SPA routing, serve index.html for any path without a file extension
        // This enables HashRouter navigation to work correctly
        if (!path.extname(filePath)) {
            filePath = '/index.html';
        }

        const absolutePath = path.join(distDir, filePath);
        logger.debug('Protocol request:', request.url, '->', absolutePath);

        return net.fetch(`file://${absolutePath}`);
    });
}

module.exports = {
    registerScheme,
    registerHandler
};
