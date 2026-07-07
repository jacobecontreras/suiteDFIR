import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ReactNode } from 'react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { apiUrl } from '@/test/handlers/base'
import { initBackendUrl } from '@/lib/api'
import { CaseProvider } from '@/context/CaseContext'
import { MockEventSource } from '@/test/mockEventSource'
import {
    INITIAL_LEAPP_PROCESSING,
    LeappProcessingState,
    useLeappProcessing,
} from './useLeappProcessing'
import { useState } from 'react'

beforeAll(async () => {
    await initBackendUrl()
})

beforeEach(() => {
    MockEventSource.reset()
    localStorage.setItem('selectedCaseId', JSON.stringify('case-1'))
})

function wrapper({ children }: { children: ReactNode }) {
    return <CaseProvider>{children}</CaseProvider>
}

function useHarness(tool = 'ileapp') {
    const [processing, setProcessing] = useState<LeappProcessingState>(INITIAL_LEAPP_PROCESSING)
    const hook = useLeappProcessing({
        tool,
        processing,
        setProcessing: (updater) => setProcessing(updater),
        isLoaded: true,
    })
    return { processing, hook }
}

describe('useLeappProcessing.startProcessing', () => {
    it('initializes state and connects to the SSE stream', async () => {
        server.use(
            http.post(apiUrl('/process/start'), () =>
                HttpResponse.json({ task_id: 'task-123' }),
            ),
        )

        const { result } = renderHook(() => useHarness(), { wrapper })
        await act(async () => {
            await result.current.hook.startProcessing('/in', '/out', ['m1', 'm2'], 'Report')
        })

        expect(result.current.processing.isRunning).toBe(true)
        expect(result.current.processing.taskId).toBe('task-123')
        expect(result.current.processing.processingReportName).toBe('Report')
        expect(result.current.processing.progress).toEqual({ current: 0, total: 2 })

        const es = MockEventSource.last()
        expect(es.url).toContain('/api/process/stream/task-123')
    })

    it('appends an error log when the start request fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        server.use(
            http.post(apiUrl('/process/start'), () =>
                HttpResponse.json({}, { status: 500 }),
            ),
        )

        const { result } = renderHook(() => useHarness(), { wrapper })
        await act(async () => {
            await result.current.hook.startProcessing('/in', '/out', [])
        })

        expect(result.current.processing.isRunning).toBe(false)
        expect(result.current.processing.logs.some((l) => l.startsWith('Error:'))).toBe(true)
    })
})

describe('useLeappProcessing - stream message handling', () => {
    async function start(result: { current: ReturnType<typeof useHarness> }) {
        server.use(
            http.post(apiUrl('/process/start'), () =>
                HttpResponse.json({ task_id: 'task-1' }),
            ),
        )
        await act(async () => {
            await result.current.hook.startProcessing('/in', '/out', ['m1', 'm2', 'm3'])
        })
    }

    it('parses [current/total] progress from log lines', async () => {
        const { result } = renderHook(() => useHarness(), { wrapper })
        await start(result)

        const es = MockEventSource.last()
        act(() => es.emitMessage('[2/5] processing module foo'))

        expect(result.current.processing.progress).toEqual({ current: 2, total: 5 })
        expect(result.current.processing.logs).toContain('[2/5] processing module foo')
    })

    it('increments progress on "artifact started" when total is set', async () => {
        const { result } = renderHook(() => useHarness(), { wrapper })
        await start(result)

        const es = MockEventSource.last()
        act(() => es.emitMessage('artifact started for module x'))
        expect(result.current.processing.progress.current).toBe(1)
        expect(result.current.processing.logs[0]).toMatch(/^\[1\/3\]/)

        act(() => es.emitMessage('artifact started for module y'))
        expect(result.current.processing.progress.current).toBe(2)
    })

    it('does not exceed total when artifact-started fires too many times', async () => {
        const { result } = renderHook(() => useHarness(), { wrapper })
        await start(result)
        const es = MockEventSource.last()
        for (let i = 0; i < 10; i++) {
            act(() => es.emitMessage('artifact started'))
        }
        expect(result.current.processing.progress.current).toBe(3)
    })

    it('flags encryption detection until a password is provided', async () => {
        const { result } = renderHook(() => useHarness(), { wrapper })
        await start(result)
        const es = MockEventSource.last()
        act(() =>
            es.emitMessage('Detected encrypted iTunes backup. Provide a password.'),
        )
        expect(result.current.processing.encryptionDetected).toBe(true)
    })

    it('ignores empty messages and the "Stream ended" sentinel', async () => {
        const { result } = renderHook(() => useHarness(), { wrapper })
        await start(result)
        const es = MockEventSource.last()
        const before = result.current.processing.logs.length
        act(() => {
            es.emitMessage('')
            es.emitMessage('Stream ended')
        })
        expect(result.current.processing.logs.length).toBe(before)
    })

    it('appends an error log on stream error', async () => {
        const { result } = renderHook(() => useHarness(), { wrapper })
        await start(result)
        const es = MockEventSource.last()
        act(() => es.error())
        expect(result.current.processing.isRunning).toBe(false)
        expect(result.current.processing.logs).toContain('Error: Connection to server lost')
    })

    it('clears isRunning when the stream is closed', async () => {
        const { result } = renderHook(() => useHarness(), { wrapper })
        await start(result)
        const es = MockEventSource.last()
        act(() => es.dispatchEvent(new Event('close')))
        await waitFor(() =>
            expect(result.current.processing.isRunning).toBe(false),
        )
    })
})

describe('useLeappProcessing.stopProcessing', () => {
    it('calls the stop endpoint and appends a stop log', async () => {
        let stopCalledWith: unknown = null
        server.use(
            http.post(apiUrl('/process/start'), () =>
                HttpResponse.json({ task_id: 'task-99' }),
            ),
            http.post(apiUrl('/process/stop'), async ({ request }) => {
                stopCalledWith = await request.json()
                return HttpResponse.json({})
            }),
        )

        const { result } = renderHook(() => useHarness(), { wrapper })
        await act(async () => {
            await result.current.hook.startProcessing('/in', '/out', [])
        })
        await act(async () => {
            await result.current.hook.stopProcessing()
        })

        expect(stopCalledWith).toEqual({ task_id: 'task-99' })
        expect(result.current.processing.isRunning).toBe(false)
        expect(result.current.processing.logs).toContain('Processing stopped by user')
    })

    it('is a no-op when there is no active task', async () => {
        const { result } = renderHook(() => useHarness(), { wrapper })
        await act(async () => {
            await result.current.hook.stopProcessing()
        })
        expect(result.current.processing.logs).toEqual([])
    })
})

describe('useLeappProcessing.clearLogs', () => {
    it('clears logs and progress', async () => {
        server.use(
            http.post(apiUrl('/process/start'), () =>
                HttpResponse.json({ task_id: 'task-1' }),
            ),
        )
        const { result } = renderHook(() => useHarness(), { wrapper })
        await act(async () => {
            await result.current.hook.startProcessing('/in', '/out', ['m'])
        })
        const es = MockEventSource.last()
        act(() => es.emitMessage('[1/1] working'))

        act(() => result.current.hook.clearLogs())
        expect(result.current.processing.logs).toEqual([])
        expect(result.current.processing.progress).toEqual({ current: 0, total: 0 })
    })
})
