import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useEventSourceStream } from './useEventSourceStream'
import { MockEventSource } from '@/test/mockEventSource'

function newSource(url = 'http://x/stream') {
    return new EventSource(url) as unknown as MockEventSource
}

describe('useEventSourceStream', () => {
    it('starts with no connections', () => {
        const { result } = renderHook(() => useEventSourceStream<string>())
        expect(result.current.hasConnection('any')).toBe(false)
    })

    it('connect registers an EventSource and forwards messages', () => {
        const onMessage = vi.fn()
        const { result } = renderHook(() => useEventSourceStream<string>())
        const es = newSource()

        act(() => {
            result.current.connect('a', es as unknown as EventSource, { onMessage })
        })

        expect(result.current.hasConnection('a')).toBe(true)

        act(() => es.emitMessage('hello'))
        expect(onMessage).toHaveBeenCalledTimes(1)
        // Strings pass through; objects are JSON-stringified by the mock.
        expect(onMessage.mock.calls[0][0].data).toBe('hello')
    })

    it('disconnect closes the underlying source and removes the entry', () => {
        const { result } = renderHook(() => useEventSourceStream<string>())
        const es = newSource()
        const closeSpy = vi.spyOn(es, 'close')

        act(() => {
            result.current.connect('a', es as unknown as EventSource, { onMessage: vi.fn() })
        })
        act(() => result.current.disconnect('a'))

        expect(closeSpy).toHaveBeenCalled()
        expect(result.current.hasConnection('a')).toBe(false)
    })

    it('reconnecting with the same key closes the previous source', () => {
        const { result } = renderHook(() => useEventSourceStream<string>())
        const first = newSource()
        const closeFirst = vi.spyOn(first, 'close')
        const second = newSource()

        act(() => {
            result.current.connect('a', first as unknown as EventSource, { onMessage: vi.fn() })
        })
        act(() => {
            result.current.connect('a', second as unknown as EventSource, { onMessage: vi.fn() })
        })

        expect(closeFirst).toHaveBeenCalled()
        expect(result.current.hasConnection('a')).toBe(true)
    })

    it('disconnectAll closes every active source', () => {
        const { result } = renderHook(() => useEventSourceStream<string>())
        const a = newSource()
        const b = newSource()
        const closeA = vi.spyOn(a, 'close')
        const closeB = vi.spyOn(b, 'close')

        act(() => {
            result.current.connect('a', a as unknown as EventSource, { onMessage: vi.fn() })
            result.current.connect('b', b as unknown as EventSource, { onMessage: vi.fn() })
        })
        act(() => result.current.disconnectAll())

        expect(closeA).toHaveBeenCalled()
        expect(closeB).toHaveBeenCalled()
        expect(result.current.hasConnection('a')).toBe(false)
        expect(result.current.hasConnection('b')).toBe(false)
    })

    it('onError closes the source and removes the entry', () => {
        const onError = vi.fn()
        const { result } = renderHook(() => useEventSourceStream<string>())
        const es = newSource()
        const closeSpy = vi.spyOn(es, 'close')

        act(() => {
            result.current.connect('a', es as unknown as EventSource, {
                onMessage: vi.fn(),
                onError,
            })
        })

        act(() => es.error())

        expect(onError).toHaveBeenCalled()
        expect(closeSpy).toHaveBeenCalled()
        expect(result.current.hasConnection('a')).toBe(false)
    })

    it('"close" custom event triggers onClose and cleanup', () => {
        const onClose = vi.fn()
        const { result } = renderHook(() => useEventSourceStream<string>())
        const es = newSource()
        const closeSpy = vi.spyOn(es, 'close')

        act(() => {
            result.current.connect('a', es as unknown as EventSource, {
                onMessage: vi.fn(),
                onClose,
            })
        })

        act(() => es.dispatchEvent(new Event('close')))

        expect(onClose).toHaveBeenCalled()
        expect(closeSpy).toHaveBeenCalled()
        expect(result.current.hasConnection('a')).toBe(false)
    })

    it('cleans up all connections on unmount', () => {
        const { result, unmount } = renderHook(() => useEventSourceStream<string>())
        const es = newSource()
        const closeSpy = vi.spyOn(es, 'close')

        act(() => {
            result.current.connect('a', es as unknown as EventSource, { onMessage: vi.fn() })
        })

        unmount()
        expect(closeSpy).toHaveBeenCalled()
    })

    it('supports numeric keys', () => {
        const { result } = renderHook(() => useEventSourceStream<number>())
        const es = newSource()
        act(() => {
            result.current.connect(7, es as unknown as EventSource, { onMessage: vi.fn() })
        })
        expect(result.current.hasConnection(7)).toBe(true)
    })
})
