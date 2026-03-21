/**
 * Logger Module for suiteDFIR Electron App
 * 
 * Provides file-based logging to diagnose startup issues in packaged apps.
 * Logs are written to: ~/Library/Application Support/suiteDFIR/startup.log
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Fallback log path before app is ready
const FALLBACK_LOG_DIR = path.join(os.tmpdir(), 'suitedfir-logs');
const FALLBACK_LOG_PATH = path.join(FALLBACK_LOG_DIR, 'startup.log');

// Log file configuration
let logPath = FALLBACK_LOG_PATH;
let initialized = false;

/**
 * Write directly to log file (synchronous, for crash-resistant logging)
 */
function writeSync(message) {
    try {
        // Ensure directory exists
        if (!fs.existsSync(FALLBACK_LOG_DIR)) {
            fs.mkdirSync(FALLBACK_LOG_DIR, { recursive: true });
        }
        fs.appendFileSync(logPath, message + '\n');
    } catch (e) {
        // Last resort - write to console
        try {
            console.error('Logger write failed:', e.message);
        } catch (consoleErr) {
            // Ignore console errors if even that fails
        }
    }
}

/**
 * Initialize the logger - call this after app is ready
 */
function init() {
    writeSync(`[${new Date().toISOString()}] [INFO ] init() called, initialized=${initialized}`);

    if (initialized) {
        writeSync(`[${new Date().toISOString()}] [INFO ] Already initialized, returning ${logPath}`);
        return logPath;
    }

    try {
        writeSync(`[${new Date().toISOString()}] [INFO ] Getting userData path...`);
        const userDataPath = app.getPath('userData');
        writeSync(`[${new Date().toISOString()}] [INFO ] userData path: ${userDataPath}`);

        const newLogPath = path.join(userDataPath, 'startup.log');
        writeSync(`[${new Date().toISOString()}] [INFO ] New log path would be: ${newLogPath}`);

        // Don't change logPath - keep using fallback for reliability
        logPath = newLogPath;

        // Ensure directory exists
        writeSync(`[${new Date().toISOString()}] [INFO ] Checking if userData dir exists...`);
        if (!fs.existsSync(userDataPath)) {
            writeSync(`[${new Date().toISOString()}] [INFO ] Creating userData dir...`);
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        writeSync(`[${new Date().toISOString()}] [INFO ] userData dir exists`);

        // Skip log rotation for now - it may be causing issues
        writeSync(`[${new Date().toISOString()}] [INFO ] Skipping log rotation`);

        initialized = true;
        writeSync(`[${new Date().toISOString()}] [INFO ] init() complete, returning ${logPath}`);

        return logPath;
    } catch (e) {
        writeSync(`[${new Date().toISOString()}] [ERROR] Logger init failed: ${e.message}`);
        writeSync(`[${new Date().toISOString()}] [ERROR] Stack: ${e.stack}`);
        return logPath;
    }
}

/**
 * Get the log file path
 */
function getLogPath() {
    return logPath;
}

/**
 * Log a message with timestamp and level
 */
function log(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase().padEnd(5)}]`;

    // Format message with args if provided
    let formattedMessage = message;
    if (args.length > 0) {
        formattedMessage = `${message} ${args.map(a => {
            try {
                return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a);
            } catch (e) {
                return String(a);
            }
        }).join(' ')}`;
    }

    const logLine = `${prefix} ${formattedMessage}`;

    // Write to file (always use sync for reliability in packaged apps)
    writeSync(logLine);

    // Also write to console for dev mode, but SKIP on Linux to prevent EBADF
    if (process.platform !== 'linux') {
        try {
            if (level === 'error') {
                console.error(logLine);
            } else {
                console.log(logLine);
            }
        } catch (e) {
            // Ignore console errors
        }
    }
}

/**
 * Log info level message
 */
function info(message, ...args) {
    log('info', message, ...args);
}

/**
 * Log error level message
 */
function error(message, ...args) {
    log('error', message, ...args);
}

/**
 * Log debug level message
 */
function debug(message, ...args) {
    log('debug', message, ...args);
}

/**
 * Log warning level message
 */
function warn(message, ...args) {
    log('warn', message, ...args);
}

/**
 * Cleanup function (no-op, kept for API compatibility)
 */
function close() {
    // No-op: logging uses sync writes
}

// Log that the module was loaded (before app ready)
writeSync(`[${new Date().toISOString()}] [INFO ] Logger module loaded`);
writeSync(`[${new Date().toISOString()}] [INFO ] __dirname: ${__dirname}`);
writeSync(`[${new Date().toISOString()}] [INFO ] process.resourcesPath: ${process.resourcesPath || 'N/A'}`);

module.exports = {
    init,
    getLogPath,
    info,
    error,
    debug,
    warn,
    close
};
