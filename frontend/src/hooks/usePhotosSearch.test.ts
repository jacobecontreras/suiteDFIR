import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { apiUrl } from '@/test/handlers/base'
import { initBackendUrl } from '@/lib/api'
import { usePhotosSearch } from './usePhotosSearch'

beforeAll(async () => {
    await initBackendUrl()
})

describe('usePhotosSearch', () => {
    it('starts in an idle state', () => {
        const { result } = renderHook(() => usePhotosSearch())
        expect(result.current.results).toBeNull()
        expect(result.current.isSearching).toBe(false)
        expect(result.current.error).toBeNull()
    })

    it('returns search results when the request succeeds', async () => {
        server.use(
            http.post(apiUrl('/photos/extractions/:id/search'), () =>
                HttpResponse.json({
                    results: [{ file_id: 'a', thumbnail_url: '', full_url: '', score: 0.9 }],
                }),
            ),
        )

        const { result } = renderHook(() => usePhotosSearch())
        await act(async () => {
            await result.current.search(1, 'red hat')
        })

        expect(result.current.results).toHaveLength(1)
        expect(result.current.results?.[0].score).toBe(0.9)
        expect(result.current.error).toBeNull()
        expect(result.current.isSearching).toBe(false)
    })

    it('treats an empty query as a clear', async () => {
        const { result } = renderHook(() => usePhotosSearch())

        // Seed some results first.
        server.use(
            http.post(apiUrl('/photos/extractions/:id/search'), () =>
                HttpResponse.json({ results: [{ file_id: 'a', thumbnail_url: '', full_url: '', score: 0.5 }] }),
            ),
        )
        await act(async () => {
            await result.current.search(1, 'something')
        })
        expect(result.current.results).toHaveLength(1)

        await act(async () => {
            await result.current.search(1, '   ')
        })
        expect(result.current.results).toBeNull()
        expect(result.current.error).toBeNull()
    })

    it('sets error and empty results on a non-ok response', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        server.use(
            http.post(apiUrl('/photos/extractions/:id/search'), () =>
                HttpResponse.json({ detail: 'index not built' }, { status: 400 }),
            ),
        )

        const { result } = renderHook(() => usePhotosSearch())
        await act(async () => {
            await result.current.search(1, 'red hat')
        })

        expect(result.current.error).toBe('index not built')
        expect(result.current.results).toEqual([])
    })

    it('sets a generic error when the fetch throws (non-abort)', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        server.use(
            http.post(apiUrl('/photos/extractions/:id/search'), () =>
                HttpResponse.error(),
            ),
        )

        const { result } = renderHook(() => usePhotosSearch())
        await act(async () => {
            await result.current.search(1, 'q')
        })

        expect(result.current.error).toBe('Search failed.')
        expect(result.current.results).toEqual([])
    })

    it('aborts an in-flight request when a new search starts', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const abortSpy = vi.spyOn(AbortController.prototype, 'abort')

        server.use(
            http.post(apiUrl('/photos/extractions/:id/search'), async () => {
                await new Promise((r) => setTimeout(r, 50))
                return HttpResponse.json({ results: [] })
            }),
        )

        const { result } = renderHook(() => usePhotosSearch())
        act(() => {
            void result.current.search(1, 'first')
        })
        await act(async () => {
            await result.current.search(1, 'second')
        })

        // First call's abort runs when the second search supersedes it.
        expect(abortSpy).toHaveBeenCalled()
    })

    it('clearSearch resets all state', async () => {
        server.use(
            http.post(apiUrl('/photos/extractions/:id/search'), () =>
                HttpResponse.json({ results: [{ file_id: 'a', thumbnail_url: '', full_url: '', score: 0.5 }] }),
            ),
        )

        const { result } = renderHook(() => usePhotosSearch())
        await act(async () => {
            await result.current.search(1, 'q')
        })
        expect(result.current.results).toHaveLength(1)

        act(() => result.current.clearSearch())
        expect(result.current.results).toBeNull()
        expect(result.current.error).toBeNull()
        expect(result.current.isSearching).toBe(false)
    })
})
