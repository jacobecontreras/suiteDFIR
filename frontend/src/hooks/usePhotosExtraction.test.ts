import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { apiUrl } from '@/test/handlers/base'
import { initBackendUrl } from '@/lib/api'
import { MockEventSource } from '@/test/mockEventSource'
import { usePhotosExtraction } from './usePhotosExtraction'

beforeAll(async () => {
    await initBackendUrl()
})

beforeEach(() => {
    MockEventSource.reset()
})

describe('usePhotosExtraction', () => {
    it('starts in an idle state', () => {
        const { result } = renderHook(() => usePhotosExtraction())
        expect(result.current.isExtracting).toBe(false)
        expect(result.current.logs).toEqual([])
        expect(result.current.progress).toBeNull()
    })

    it('handles a non-ok response and returns null', async () => {
        server.use(
            http.post(apiUrl('/photos/extract'), () =>
                HttpResponse.json({ detail: 'boom' }, { status: 400 }),
            ),
        )

        const { result } = renderHook(() => usePhotosExtraction())
        let returned: { extractionId: number } | null = { extractionId: -1 }
        await act(async () => {
            returned = await result.current.startExtraction(1, 1)
        })

        expect(returned).toBeNull()
        expect(result.current.isExtracting).toBe(false)
        expect(result.current.logs).toContain('Error: boom')
    })

    it('records logs and progress emitted by the SSE stream', async () => {
        server.use(
            http.post(apiUrl('/photos/extract'), () =>
                HttpResponse.json({ task_id: 't1', extraction_id: 99 }),
            ),
        )

        const { result } = renderHook(() => usePhotosExtraction())

        await act(async () => {
            const res = await result.current.startExtraction(1, 1)
            expect(res?.extractionId).toBe(99)
        })

        const es = MockEventSource.last()
        act(() => {
            es.emitMessage({ type: 'log', message: 'starting' })
            es.emitMessage({ type: 'progress', current: 5, total: 10, phase: 'index' })
            es.emitMessage({ type: 'log', message: 'mid' })
        })

        expect(result.current.logs).toEqual(['starting', 'mid'])
        expect(result.current.progress).toEqual({ current: 5, total: 10, phase: 'index' })
        expect(result.current.extractionId).toBe(99)
    })

    it('appends plain-text fallback when JSON parsing fails', async () => {
        server.use(
            http.post(apiUrl('/photos/extract'), () =>
                HttpResponse.json({ task_id: 't1', extraction_id: 99 }),
            ),
        )

        const { result } = renderHook(() => usePhotosExtraction())
        await act(async () => {
            await result.current.startExtraction(1, 1)
        })

        const es = MockEventSource.last()
        act(() => es.emitMessage('plain text log'))

        expect(result.current.logs).toContain('plain text log')
    })

    it('clears isExtracting when the stream closes', async () => {
        server.use(
            http.post(apiUrl('/photos/extract'), () =>
                HttpResponse.json({ task_id: 't1', extraction_id: 1 }),
            ),
        )

        const { result } = renderHook(() => usePhotosExtraction())
        await act(async () => {
            await result.current.startExtraction(1, 1)
        })

        await waitFor(() => expect(result.current.isExtracting).toBe(true))

        const es = MockEventSource.last()
        act(() => es.dispatchEvent(new Event('close')))

        await waitFor(() => expect(result.current.isExtracting).toBe(false))
    })

    it('clearLogs resets logs and progress only', async () => {
        server.use(
            http.post(apiUrl('/photos/extract'), () =>
                HttpResponse.json({ task_id: 't1', extraction_id: 1 }),
            ),
        )
        const { result } = renderHook(() => usePhotosExtraction())
        await act(async () => {
            await result.current.startExtraction(1, 1)
        })
        const es = MockEventSource.last()
        act(() => {
            es.emitMessage({ type: 'log', message: 'a' })
            es.emitMessage({ type: 'progress', current: 1, total: 1, phase: 'p' })
        })

        act(() => result.current.clearLogs())

        expect(result.current.logs).toEqual([])
        expect(result.current.progress).toBeNull()
        expect(result.current.extractionId).toBe(1)
    })

    it('handles fetch throwing entirely', async () => {
        server.use(
            http.post(apiUrl('/photos/extract'), () => HttpResponse.error()),
        )
        const { result } = renderHook(() => usePhotosExtraction())
        await act(async () => {
            const r = await result.current.startExtraction(1, 1)
            expect(r).toBeNull()
        })
        expect(result.current.isExtracting).toBe(false)
        expect(result.current.logs.some((l) => l.startsWith('Failed to start extraction'))).toBe(true)
    })
})
