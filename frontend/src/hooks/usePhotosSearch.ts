import { useState, useCallback, useRef } from 'react'
import { API } from '@/lib/api'
import type { PhotoSearchResult } from '@/types/photos'

interface UsePhotosSearchReturn {
    results: PhotoSearchResult[] | null
    isSearching: boolean
    error: string | null
    search: (extractionId: number, query: string, threshold?: number) => Promise<void>
    clearSearch: () => void
}

export function usePhotosSearch(): UsePhotosSearchReturn {
    const [results, setResults] = useState<PhotoSearchResult[] | null>(null)
    const [isSearching, setIsSearching] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const search = useCallback(async (
        extractionId: number,
        query: string,
        threshold: number = 0.20,
    ) => {
        // Abort previous request
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        if (!query.trim()) {
            setResults(null)
            setError(null)
            return
        }

        setIsSearching(true)
        setError(null)

        try {
            const res = await fetch(
                API.path(`/photos/extractions/${extractionId}/search`),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query, threshold }),
                    signal: controller.signal,
                }
            )

            if (!res.ok) {
                const err = await res.json()
                console.error('Search error:', err.detail)
                setError(err.detail ?? 'Search failed.')
                setResults([])
                return
            }

            const data = await res.json()
            setResults(data.results)
        } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') return
            console.error('Search failed:', e)
            setError('Search failed.')
            setResults([])
        } finally {
            setIsSearching(false)
        }
    }, [])

    const clearSearch = useCallback(() => {
        abortRef.current?.abort()
        setResults(null)
        setIsSearching(false)
        setError(null)
    }, [])

    return { results, isSearching, error, search, clearSearch }
}
