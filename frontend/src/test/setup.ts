import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './server'
import { MockEventSource, installMockEventSource, uninstallMockEventSource } from './mockEventSource'

beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' })
    installMockEventSource()
})

afterEach(() => {
    cleanup()
    server.resetHandlers()
    localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
    MockEventSource.reset()
})

afterAll(() => {
    server.close()
    uninstallMockEventSource()
})

if (typeof window !== 'undefined' && !('matchMedia' in window)) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }),
    })
}

if (typeof window !== 'undefined' && !('ResizeObserver' in window)) {
    class ResizeObserverMock {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    ;(window as unknown as { ResizeObserver: typeof ResizeObserverMock }).ResizeObserver = ResizeObserverMock
}
