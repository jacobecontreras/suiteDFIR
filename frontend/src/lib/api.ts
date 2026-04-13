/**
 * Centralized API configuration for suiteDFIR
 * Supports dynamic port allocation via Electron IPC
 */

// Fallback for development without Electron
const DEV_BACKEND_URL = 'http://localhost:8000';

let cachedBackendUrl: string | null = null;
let initPromise: Promise<string> | null = null;

/**
 * Initialize the backend URL (call early in app lifecycle)
 * Returns immediately if already initialized
 */
export async function initBackendUrl(): Promise<string> {
    if (cachedBackendUrl) return cachedBackendUrl;

    if (initPromise) return initPromise;

    initPromise = (async () => {
        // Check if running in Electron with our API exposed
        if (typeof window !== 'undefined' && (window as unknown as { electronAPI?: { getBackendUrl: () => Promise<string> } }).electronAPI?.getBackendUrl) {
            try {
                const url = await (window as unknown as { electronAPI: { getBackendUrl: () => Promise<string> } }).electronAPI.getBackendUrl();
                if (url) {
                    cachedBackendUrl = url;
                    console.log('[API] Backend URL from Electron:', cachedBackendUrl);
                    return cachedBackendUrl;
                }
            } catch (e) {
                console.warn('[API] Failed to get backend URL from Electron:', e);
            }
        }

        // Fallback for development in browser
        cachedBackendUrl = DEV_BACKEND_URL;
        console.log('[API] Using fallback backend URL:', cachedBackendUrl);
        return cachedBackendUrl;
    })();

    return initPromise;
}

/**
 * Synchronous getter - returns cached URL or dev fallback
 * Use only after initBackendUrl() has been called
 */
export function getBackendUrlSync(): string {
    return cachedBackendUrl || DEV_BACKEND_URL;
}

/**
 * API path helpers for consistent URL construction
 * All methods are synchronous - ensure initBackendUrl() is called early in app lifecycle
 */
export const API = {
    /** Base URL of the backend (e.g., http://localhost:8000) */
    base: () => getBackendUrlSync(),

    /** Build a full API path (e.g., /cases -> http://localhost:8000/api/cases) */
    path: (endpoint: string) => `${getBackendUrlSync()}/api${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`,

    /** Build a full URL from a path (e.g., /reports/1 -> http://localhost:8000/reports/1) */
    url: (path: string) => `${getBackendUrlSync()}${path.startsWith('/') ? path : '/' + path}`,
} as const;
