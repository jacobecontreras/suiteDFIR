/**
 * Controllable EventSource mock for streaming hook tests.
 *
 * Usage:
 *   const es = MockEventSource.last()
 *   es.emit('progress', { percent: 50 })
 *   es.emit('log', 'hello')
 *   es.emitMessage('default-message')
 *   es.error()
 *   es.open()
 */

type Listener = (event: MessageEvent | Event) => void

export class MockEventSource implements EventSource {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSED = 2

    readonly CONNECTING = 0 as const
    readonly OPEN = 1 as const
    readonly CLOSED = 2 as const

    readonly url: string
    readonly withCredentials = false
    readyState: 0 | 1 | 2 = 0

    onopen: ((this: EventSource, ev: Event) => unknown) | null = null
    onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null
    onerror: ((this: EventSource, ev: Event) => unknown) | null = null

    private listeners: Record<string, Set<Listener>> = {}

    static instances: MockEventSource[] = []

    constructor(url: string | URL) {
        this.url = url.toString()
        MockEventSource.instances.push(this)
        queueMicrotask(() => this.open())
    }

    addEventListener(type: string, listener: Listener): void {
        if (!this.listeners[type]) this.listeners[type] = new Set()
        this.listeners[type].add(listener)
    }

    removeEventListener(type: string, listener: Listener): void {
        this.listeners[type]?.delete(listener)
    }

    dispatchEvent(event: Event): boolean {
        const type = event.type
        if (type === 'open' && this.onopen) this.onopen.call(this, event)
        if (type === 'error' && this.onerror) this.onerror.call(this, event)
        if (type === 'message' && this.onmessage) {
            this.onmessage.call(this, event as MessageEvent)
        }
        this.listeners[type]?.forEach((l) => l(event))
        return true
    }

    close(): void {
        this.readyState = this.CLOSED
    }

    // ---- Test helpers (not part of EventSource interface) ----

    open(): void {
        if (this.readyState === this.CLOSED) return
        this.readyState = this.OPEN
        this.dispatchEvent(new Event('open'))
    }

    /**
     * Emit a custom named SSE event. Data is JSON-stringified if not already a string.
     */
    emit(type: string, data: unknown): void {
        const payload = typeof data === 'string' ? data : JSON.stringify(data)
        const event = new MessageEvent(type, { data: payload })
        this.dispatchEvent(event)
    }

    /** Emit a default (unnamed) 'message' event. */
    emitMessage(data: unknown): void {
        this.emit('message', data)
    }

    error(): void {
        this.dispatchEvent(new Event('error'))
    }

    static last(): MockEventSource {
        const inst = MockEventSource.instances.at(-1)
        if (!inst) throw new Error('No MockEventSource instances created yet')
        return inst
    }

    static reset(): void {
        MockEventSource.instances = []
    }
}

let originalEventSource: typeof EventSource | undefined

export function installMockEventSource(): void {
    originalEventSource = (globalThis as { EventSource?: typeof EventSource }).EventSource
    ;(globalThis as { EventSource: typeof EventSource }).EventSource =
        MockEventSource as unknown as typeof EventSource
}

export function uninstallMockEventSource(): void {
    if (originalEventSource) {
        ;(globalThis as { EventSource: typeof EventSource }).EventSource = originalEventSource
    } else {
        delete (globalThis as { EventSource?: typeof EventSource }).EventSource
    }
}
