import { useState, useCallback, useEffect, useRef } from 'react'
import { Search, X, Trash2 } from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui'
import { usePhotos } from '@/context/PhotosContext'
import { ForensicFilterBar, ClassificationFilter } from './ForensicFilterBar'
import type { PhotoExtraction } from '@/types/photos'

export function GalleryToolbar() {
    const {
        extractions,
        selectedExtraction,
        selectExtraction,
        deleteExtraction,
        searchQuery,
        setSearchQuery,
        executeSearch,
        clearSearch,
        isSearching,
        searchError,
        searchResults,
        threshold,
        setThreshold,
        totalPhotos,
    } = usePhotos()

    const completedExtractions = extractions.filter(e => e.status === 'completed' && e.image_count > 0)
    const photoCount = searchResults ? searchResults.length : totalPhotos

    const [localQuery, setLocalQuery] = useState(searchQuery)
    const externalSyncRef = useRef(false)

    // Sync localQuery when searchQuery changes externally (e.g. forensic preset)
    useEffect(() => {
        externalSyncRef.current = true
        setLocalQuery(searchQuery)
    }, [searchQuery])

    // Debounced search — skip when localQuery was synced from an external source
    // (the caller already triggered the search), but still fire on threshold changes.
    useEffect(() => {
        if (!localQuery.trim()) {
            if (searchQuery) clearSearch()
            return
        }
        if (externalSyncRef.current) {
            externalSyncRef.current = false
            return
        }
        const timer = setTimeout(() => {
            setSearchQuery(localQuery)
            executeSearch(localQuery)
        }, 400)
        return () => clearTimeout(timer)
    }, [localQuery, threshold]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleClearSearch = useCallback(() => {
        setLocalQuery('')
        clearSearch()
    }, [clearSearch])

    const handleExtractionChange = useCallback((value: string) => {
        const ext = completedExtractions.find(e => String(e.id) === value)
        if (ext) selectExtraction(ext)
    }, [completedExtractions, selectExtraction])

    const canSearch = selectedExtraction?.indexed

    return (
        <div className="border-b border-[#222222] bg-[#151515]">
            {/* Top bar */}
            <div className="flex items-center gap-3 px-4 py-3">
                {/* Extraction selector */}
                <Select
                    value={selectedExtraction ? String(selectedExtraction.id) : ''}
                    onValueChange={handleExtractionChange}
                >
                    <SelectTrigger className="w-[280px] h-9 bg-[#2a2a2a] border border-white/10 text-white rounded-lg">
                        <SelectValue placeholder="Select extraction">
                            {selectedExtraction
                                ? `${selectedExtraction.device_name} — ${selectedExtraction.image_count} photos`
                                : 'Select extraction'}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                        className="bg-[#2a2a2a] border border-white/10 rounded-lg"
                        align="start"
                        itemCount={completedExtractions.length}
                    >
                        {completedExtractions.map((ext) => (
                            <SelectItem
                                key={ext.id}
                                value={String(ext.id)}
                                className="text-white rounded-md"
                            >
                                <div className="flex items-center gap-2 w-full">
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <span className="truncate font-medium">{ext.device_name}</span>
                                        <span className="text-[#888] text-xs truncate">
                                            {ext.image_count} photos &middot; {new Date(ext.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            deleteExtraction(ext.id)
                                        }}
                                        className="shrink-0 p-1 text-gray-600 hover:text-red-400 transition-colors rounded hover:bg-white/10"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <ClassificationFilter />

                <div className="flex-1 min-w-0">
                    <span className="text-xs text-gray-500">
                        {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
                    </span>
                </div>
            </div>

            {/* Search bar */}
            {canSearch && (
                <div className="px-4 pb-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
                        <input
                            type="text"
                            value={localQuery}
                            onChange={e => setLocalQuery(e.target.value)}
                            placeholder="Search photos with natural language..."
                            className="w-full pl-9 pr-8 py-2 rounded-md bg-[#1e1e1e] border border-[#333333] text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-[#555555]"
                        />
                        {localQuery && (
                            <button
                                onClick={handleClearSearch}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Forensic filter pills */}
                    <ForensicFilterBar />

                    {/* Threshold slider (visible when searching) */}
                    {localQuery && (
                        <div className="flex items-center gap-3 mt-2">
                            <span className="text-[11px] text-gray-500">Threshold</span>
                            <input
                                type="range"
                                min={0.15}
                                max={0.40}
                                step={0.01}
                                value={threshold}
                                onChange={e => setThreshold(parseFloat(e.target.value))}
                                className="flex-1 h-1 accent-gray-500"
                            />
                            <span className="text-[11px] text-gray-400 w-8 text-right">
                                {threshold.toFixed(2)}
                            </span>
                        </div>
                    )}

                    {searchError && (
                        <p className="mt-2 text-[11px] text-red-400">{searchError}</p>
                    )}
                </div>
            )}

            {!canSearch && selectedExtraction && (
                <div className="px-4 pb-3">
                    <p className="text-xs text-gray-600">
                        Search is not available — the search index was not built for this extraction.
                    </p>
                </div>
            )}
        </div>
    )
}
