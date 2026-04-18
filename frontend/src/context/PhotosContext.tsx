import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useCase } from './CaseContext'
import { useCasePersistedState } from '@/hooks/useCasePersistedState'
import { API } from '@/lib/api'
import type { PhotoExtraction, PhotoItem, PhotoSearchResult, PhotoSort, PhotoFilters, ForensicFilter } from '@/types/photos'
import { usePhotosSearch } from '@/hooks/usePhotosSearch'

interface PhotosContextType {
    // Extractions
    extractions: PhotoExtraction[]
    selectedExtraction: PhotoExtraction | null
    selectExtraction: (extraction: PhotoExtraction | null) => void
    loadExtractions: () => Promise<void>
    deleteExtraction: (id: number) => Promise<void>

    // Gallery
    photos: PhotoItem[]
    totalPhotos: number
    page: number
    pageSize: number
    isLoadingPhotos: boolean
    loadPhotos: (page?: number) => Promise<void>
    loadMorePhotos: () => Promise<void>

    // Search
    searchResults: PhotoSearchResult[] | null
    isSearching: boolean
    searchError: string | null
    searchQuery: string
    setSearchQuery: (q: string) => void
    executeSearch: (query: string) => Promise<void>
    clearSearch: () => void

    // Filters & sort
    sort: PhotoSort
    setSort: (s: PhotoSort) => void
    threshold: number
    setThreshold: (t: number) => void
    filters: PhotoFilters
    setFilters: (f: PhotoFilters) => void
    activeForensicFilter: ForensicFilter | null
    setActiveForensicFilter: (f: ForensicFilter | null) => void
}

const PhotosContext = createContext<PhotosContextType | undefined>(undefined)

export function PhotosProvider({ children }: { children: ReactNode }) {
    const { selectedCaseId } = useCase()

    // Extractions
    const [extractions, setExtractions] = useState<PhotoExtraction[]>([])
    const [selectedExtractionId, setSelectedExtractionId] = useCasePersistedState<number | null>(
        'photos_selected_extraction', null
    )

    const completedExtractions = extractions.filter(e => e.status === 'completed' && e.image_count > 0)
    const selectedExtraction = extractions.find(e => e.id === selectedExtractionId) ?? null

    // Auto-select first completed extraction if none selected
    useEffect(() => {
        if (!selectedExtraction && completedExtractions.length > 0) {
            setSelectedExtractionId(completedExtractions[0].id)
        }
    }, [completedExtractions.length, selectedExtraction, setSelectedExtractionId]) // eslint-disable-line react-hooks/exhaustive-deps

    // Gallery
    const [photos, setPhotos] = useState<PhotoItem[]>([])
    const [totalPhotos, setTotalPhotos] = useState(0)
    const [page, setPage] = useState(0)
    const [isLoadingPhotos, setIsLoadingPhotos] = useState(false)
    const pageSize = 100

    // Search
    const [searchQuery, setSearchQuery] = useState('')
    const [activeForensicFilter, setActiveForensicFilter] = useState<ForensicFilter | null>(null)

    // Filters
    const [sort, setSort] = useCasePersistedState<PhotoSort>('photos_sort', 'newest')
    const [threshold, setThreshold] = useCasePersistedState<number>('photos_threshold', 0.20)
    const [filters, setFilters] = useState<PhotoFilters>({ classification: 'original' })

    // Hooks
    const search = usePhotosSearch()

    // Load extractions on case change
    const loadExtractions = useCallback(async () => {
        if (!selectedCaseId) return
        try {
            const res = await fetch(API.path(`/photos/extractions?case_id=${selectedCaseId}`))
            if (res.ok) {
                const data = await res.json()
                setExtractions(data)
            }
        } catch (e) {
            console.error('Failed to load extractions:', e)
        }
    }, [selectedCaseId])

    useEffect(() => {
        loadExtractions()
    }, [loadExtractions])

    // Load photos
    const loadPhotos = useCallback(async (requestPage: number = 0) => {
        if (!selectedExtraction) return
        setIsLoadingPhotos(true)

        try {
            const params = new URLSearchParams({
                page: String(requestPage),
                page_size: String(pageSize),
                sort,
            })
            if (filters.mediaType) params.set('media_type', filters.mediaType)
            if (filters.hasGps !== undefined) params.set('has_gps', String(filters.hasGps))
            if (filters.dateFrom) params.set('date_from', filters.dateFrom)
            if (filters.dateTo) params.set('date_to', filters.dateTo)
            if (filters.classification) params.set('classification', filters.classification)

            const res = await fetch(
                API.path(`/photos/extractions/${selectedExtraction.id}/photos?${params}`)
            )
            if (res.ok) {
                const data = await res.json()
                if (requestPage === 0) {
                    setPhotos(data.photos)
                } else {
                    setPhotos(prev => [...prev, ...data.photos])
                }
                setTotalPhotos(data.total)
                setPage(requestPage)

                void fetch(API.path(`/photos/extractions/${selectedExtraction.id}/thumbnails/warm`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        file_ids: data.photos.map((photo: PhotoItem) => photo.file_id),
                    }),
                }).catch(() => {})
            }
        } catch (e) {
            console.error('Failed to load photos:', e)
        } finally {
            setIsLoadingPhotos(false)
        }
    }, [selectedExtraction, sort, filters, pageSize])

    const loadMorePhotos = useCallback(async () => {
        if (photos.length >= totalPhotos) return
        await loadPhotos(page + 1)
    }, [loadPhotos, page, photos.length, totalPhotos])

    // Load photos when extraction or filters change
    useEffect(() => {
        if (selectedExtraction?.status === 'completed') {
            setPhotos([])
            setPage(0)
            loadPhotos(0)
        }
    }, [selectedExtraction?.id, sort, filters]) // eslint-disable-line react-hooks/exhaustive-deps

    // Search
    const executeSearch = useCallback(async (query: string) => {
        if (!selectedExtraction) return
        await search.search(selectedExtraction.id, query, threshold)
    }, [selectedExtraction, search, threshold])

    const clearSearchHandler = useCallback(() => {
        search.clearSearch()
        setSearchQuery('')
        setActiveForensicFilter(null)
    }, [search])

    // Select extraction
    const selectExtraction = useCallback((ext: PhotoExtraction | null) => {
        setSelectedExtractionId(ext?.id ?? null)
        setPhotos([])
        setTotalPhotos(0)
        setPage(0)
        search.clearSearch()
        setSearchQuery('')
        setActiveForensicFilter(null)
    }, [setSelectedExtractionId, search])

    // Delete extraction
    const deleteExtraction = useCallback(async (id: number) => {
        try {
            const res = await fetch(API.path(`/photos/extractions/${id}`), { method: 'DELETE' })
            if (res.ok) {
                if (selectedExtractionId === id) {
                    selectExtraction(null)
                }
                await loadExtractions()
            }
        } catch (e) {
            console.error('Failed to delete extraction:', e)
        }
    }, [selectedExtractionId, selectExtraction, loadExtractions])

    return (
        <PhotosContext.Provider
            value={{
                extractions,
                selectedExtraction,
                selectExtraction,
                loadExtractions,
                deleteExtraction,

                photos,
                totalPhotos,
                page,
                pageSize,
                isLoadingPhotos,
                loadPhotos,
                loadMorePhotos,

                searchResults: search.results,
                isSearching: search.isSearching,
                searchError: search.error,
                searchQuery,
                setSearchQuery,
                executeSearch,
                clearSearch: clearSearchHandler,

                sort,
                setSort,
                threshold,
                setThreshold,
                filters,
                setFilters,
                activeForensicFilter,
                setActiveForensicFilter,
            }}
        >
            {children}
        </PhotosContext.Provider>
    )
}

export function usePhotos() {
    const context = useContext(PhotosContext)
    if (!context) {
        throw new Error('usePhotos must be used within a PhotosProvider')
    }
    return context
}
