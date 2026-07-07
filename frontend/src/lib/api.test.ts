import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface WindowWithElectron extends Window {
    electronAPI?: { getBackendUrl: () => Promise<string> }
}

async function freshImport() {
    vi.resetModules()
    return await import('./api')
}

describe('initBackendUrl', () => {
    const originalElectron = (window as WindowWithElectron).electronAPI

    beforeEach(() => {
        delete (window as WindowWithElectron).electronAPI
    })

    afterEach(() => {
        if (originalElectron) {
            ;(window as WindowWithElectron).electronAPI = originalElectron
        } else {
            delete (window as WindowWithElectron).electronAPI
        }
    })

    it('falls back to dev URL when Electron is not available', async () => {
        const { initBackendUrl } = await freshImport()
        const url = await initBackendUrl()
        expect(url).toBe('http://localhost:8000')
    })

    it('uses the Electron-provided URL when present', async () => {
        ;(window as WindowWithElectron).electronAPI = {
            getBackendUrl: vi.fn().mockResolvedValue('http://localhost:54321'),
        }
        const { initBackendUrl, getBackendUrlSync } = await freshImport()
        await initBackendUrl()
        expect(getBackendUrlSync()).toBe('http://localhost:54321')
    })

    it('falls back to dev URL if Electron returns empty string', async () => {
        ;(window as WindowWithElectron).electronAPI = {
            getBackendUrl: vi.fn().mockResolvedValue(''),
        }
        const { initBackendUrl } = await freshImport()
        const url = await initBackendUrl()
        expect(url).toBe('http://localhost:8000')
    })

    it('falls back when Electron throws', async () => {
        ;(window as WindowWithElectron).electronAPI = {
            getBackendUrl: vi.fn().mockRejectedValue(new Error('ipc fail')),
        }
        const { initBackendUrl } = await freshImport()
        const url = await initBackendUrl()
        expect(url).toBe('http://localhost:8000')
    })

    it('caches the result across calls', async () => {
        const getBackendUrl = vi.fn().mockResolvedValue('http://localhost:9999')
        ;(window as WindowWithElectron).electronAPI = { getBackendUrl }
        const { initBackendUrl } = await freshImport()
        await initBackendUrl()
        await initBackendUrl()
        await initBackendUrl()
        expect(getBackendUrl).toHaveBeenCalledTimes(1)
    })

    it('dedupes concurrent calls into a single promise', async () => {
        const getBackendUrl = vi.fn().mockResolvedValue('http://localhost:7777')
        ;(window as WindowWithElectron).electronAPI = { getBackendUrl }
        const { initBackendUrl } = await freshImport()
        const [a, b] = await Promise.all([initBackendUrl(), initBackendUrl()])
        expect(a).toBe('http://localhost:7777')
        expect(b).toBe('http://localhost:7777')
        expect(getBackendUrl).toHaveBeenCalledTimes(1)
    })
})

describe('API helpers', () => {
    it('builds an API path with a leading slash', async () => {
        const { API, initBackendUrl } = await freshImport()
        await initBackendUrl()
        expect(API.path('/cases')).toBe('http://localhost:8000/api/cases')
    })

    it('adds a leading slash if missing', async () => {
        const { API, initBackendUrl } = await freshImport()
        await initBackendUrl()
        expect(API.path('cases')).toBe('http://localhost:8000/api/cases')
    })

    it('returns the bare base URL', async () => {
        const { API, initBackendUrl } = await freshImport()
        await initBackendUrl()
        expect(API.base()).toBe('http://localhost:8000')
    })

    it('builds non-/api URLs', async () => {
        const { API, initBackendUrl } = await freshImport()
        await initBackendUrl()
        expect(API.url('/reports/123')).toBe('http://localhost:8000/reports/123')
        expect(API.url('reports/123')).toBe('http://localhost:8000/reports/123')
    })

    it('getBackendUrlSync returns dev URL when not initialized', async () => {
        const { getBackendUrlSync } = await freshImport()
        expect(getBackendUrlSync()).toBe('http://localhost:8000')
    })
})
