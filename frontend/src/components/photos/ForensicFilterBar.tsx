import { useCallback } from 'react'
import { usePhotos } from '@/context/PhotosContext'
import { FORENSIC_FILTER_QUERIES } from '@/types/photos'
import type { ForensicFilter, PhotoSort } from '@/types/photos'

const FILTERS: { key: ForensicFilter; label: string }[] = [
    { key: 'weapons', label: 'Weapons' },
    { key: 'drugs', label: 'Drugs' },
    { key: 'currency', label: 'Currency' },
    { key: 'documents', label: 'Documents' },
    { key: 'vehicles', label: 'Vehicles' },
    { key: 'screenshots', label: 'Screenshots' },
    { key: 'faces', label: 'Faces' },
    { key: 'locations', label: 'Locations' },
]

const SORT_OPTIONS: { value: PhotoSort; label: string }[] = [
    { value: 'newest', label: 'Newest' },
    { value: 'oldest', label: 'Oldest' },
]

export function ClassificationFilter() {
    const { filters, setFilters } = usePhotos()

    return (
        <div className="flex items-center gap-1.5">
            {([
                { value: 'original' as const, label: 'Originals' },
                { value: undefined as 'original' | 'derivative' | undefined, label: 'All Photos' },
            ]).map(opt => (
                <button
                    key={opt.label}
                    onClick={() => setFilters({ ...filters, classification: opt.value })}
                    className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                        filters.classification === opt.value
                            ? 'border-gray-500/50 bg-white/5 text-gray-200'
                            : 'border-[#333333] text-gray-500 hover:text-gray-300 hover:border-[#555555]'
                    }`}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

export function ForensicFilterBar() {
    const {
        activeForensicFilter,
        setActiveForensicFilter,
        executeSearch,
        setSearchQuery,
        clearSearch,
        sort,
        setSort,
        filters,
        setFilters,
    } = usePhotos()

    const handleFilterClick = useCallback((filter: ForensicFilter) => {
        if (activeForensicFilter === filter) {
            setActiveForensicFilter(null)
            clearSearch()
            return
        }

        setActiveForensicFilter(filter)

        const query = FORENSIC_FILTER_QUERIES[filter]
        setSearchQuery(query)
        executeSearch(query)
    }, [activeForensicFilter, setActiveForensicFilter, executeSearch, setSearchQuery, clearSearch])

    return (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {/* Preset pills */}
            {FILTERS.map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => handleFilterClick(key)}
                    className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                        activeForensicFilter === key
                            ? 'border-gray-500/50 bg-white/5 text-gray-200'
                            : 'border-[#333333] text-gray-500 hover:text-gray-300 hover:border-[#555555]'
                    }`}
                >
                    {label}
                </button>
            ))}

            {/* Separator */}
            <div className="w-px h-4 bg-[#333333] mx-1" />

            {/* Sort */}
            {SORT_OPTIONS.map(opt => (
                <button
                    key={opt.value}
                    onClick={() => setSort(opt.value)}
                    className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
                        sort === opt.value
                            ? 'border-gray-500/50 bg-white/5 text-gray-200'
                            : 'border-[#333333] text-gray-500 hover:text-gray-300 hover:border-[#555555]'
                    }`}
                >
                    {opt.label}
                </button>
            ))}

            {/* Separator */}
            <div className="w-px h-4 bg-[#333333] mx-1" />

            {/* Date filters */}
            <div className="flex items-center gap-1.5">
                <input
                    type="date"
                    value={filters.dateFrom ?? ''}
                    onChange={e => setFilters({ ...filters, dateFrom: e.target.value || undefined })}
                    className="px-2 py-1 rounded-full bg-transparent border border-[#333333] text-[11px] text-gray-400 focus:outline-none focus:border-[#555555] [color-scheme:dark]"
                />
                <span className="text-[11px] text-gray-600">—</span>
                <input
                    type="date"
                    value={filters.dateTo ?? ''}
                    onChange={e => setFilters({ ...filters, dateTo: e.target.value || undefined })}
                    className="px-2 py-1 rounded-full bg-transparent border border-[#333333] text-[11px] text-gray-400 focus:outline-none focus:border-[#555555] [color-scheme:dark]"
                />
                {(filters.dateFrom || filters.dateTo) && (
                    <button
                        onClick={() => setFilters({ ...filters, dateFrom: undefined, dateTo: undefined })}
                        className="text-[11px] text-gray-500 hover:text-gray-300 ml-0.5"
                    >
                        Clear
                    </button>
                )}
            </div>
        </div>
    )
}
