import { useState, useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { API } from '@/lib/api'
import { PhotoPreviewModal } from './PhotoPreviewModal'
import type { PhotoItem, PhotoSearchResult } from '@/types/photos'

interface PhotoGridProps {
    items: (PhotoItem | PhotoSearchResult)[]
    isLoading: boolean
    hasMore: boolean
    onLoadMore: () => void
}

const GAP = 4
const MIN_THUMB = 140

export function PhotoGrid({ items, isLoading, hasMore, onLoadMore }: PhotoGridProps) {
    const [previewIndex, setPreviewIndex] = useState<number | null>(null)
    const parentRef = useRef<HTMLDivElement>(null)
    const [columns, setColumns] = useState(6)

    // Responsive column count via ResizeObserver
    useEffect(() => {
        const el = parentRef.current
        if (!el) return
        const observer = new ResizeObserver(([entry]) => {
            const width = entry.contentRect.width
            setColumns(Math.max(3, Math.min(8, Math.floor(width / MIN_THUMB))))
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    const rowCount = Math.ceil(items.length / columns)
    const cellSize = parentRef.current
        ? Math.floor((parentRef.current.clientWidth - GAP * (columns - 1)) / columns)
        : MIN_THUMB

    const virtualizer = useVirtualizer({
        count: rowCount + (hasMore ? 1 : 0), // +1 for sentinel row
        getScrollElement: () => parentRef.current,
        estimateSize: () => cellSize + GAP,
        overscan: 6,
    })

    // Trigger load-more when sentinel row is rendered
    const virtualItems = virtualizer.getVirtualItems()
    const lastItem = virtualItems[virtualItems.length - 1]
    useEffect(() => {
        if (!lastItem || !hasMore || isLoading) return
        if (lastItem.index >= rowCount) {
            onLoadMore()
        }
    }, [lastItem?.index, rowCount, hasMore, isLoading, onLoadMore])

    const handlePrev = useCallback(() => {
        setPreviewIndex(prev => (prev !== null && prev > 0 ? prev - 1 : prev))
    }, [])

    const handleNext = useCallback(() => {
        setPreviewIndex(prev => (prev !== null && prev < items.length - 1 ? prev + 1 : prev))
    }, [items.length])

    if (items.length === 0 && !isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
                No photos found.
            </div>
        )
    }

    return (
        <>
            <div ref={parentRef} className="flex-1 overflow-y-auto p-2">
                <div
                    style={{
                        height: virtualizer.getTotalSize(),
                        position: 'relative',
                        width: '100%',
                    }}
                >
                    {virtualItems.map((virtualRow) => {
                        // Sentinel row (beyond actual data)
                        if (virtualRow.index >= rowCount) {
                            return (
                                <div
                                    key="sentinel"
                                    style={{
                                        position: 'absolute',
                                        top: virtualRow.start,
                                        left: 0,
                                        width: '100%',
                                        height: 1,
                                    }}
                                />
                            )
                        }

                        const startIndex = virtualRow.index * columns
                        return (
                            <div
                                key={virtualRow.index}
                                style={{
                                    position: 'absolute',
                                    top: virtualRow.start,
                                    left: 0,
                                    right: 0,
                                    height: cellSize,
                                    display: 'grid',
                                    gridTemplateColumns: `repeat(${columns}, 1fr)`,
                                    gap: GAP,
                                }}
                            >
                                {Array.from({ length: columns }, (_, colIndex) => {
                                    const photoIndex = startIndex + colIndex
                                    if (photoIndex >= items.length) return null
                                    const item = items[photoIndex]
                                    return (
                                        <div
                                            key={item.file_id}
                                            onClick={() => setPreviewIndex(photoIndex)}
                                            className="relative cursor-pointer group overflow-hidden rounded bg-[#1a1a1a]"
                                            style={{ aspectRatio: '1' }}
                                        >
                                            <img
                                                src={API.url(item.thumbnail_url)}
                                                alt=""
                                                loading="eager"
                                                decoding="async"
                                                fetchPriority="high"
                                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                            />
                                            {'score' in item && (
                                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1">
                                                    <span className="text-[10px] text-gray-300">
                                                        {(item.score * 100).toFixed(0)}%
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}
                </div>

                {/* Loading indicator */}
                {isLoading && (
                    <div className="py-6 flex justify-center">
                        <div className="w-5 h-5 border-2 border-[#333333] border-t-gray-400 rounded-full animate-spin" />
                    </div>
                )}
            </div>

            {/* Preview modal */}
            {previewIndex !== null && items[previewIndex] && (
                <PhotoPreviewModal
                    item={items[previewIndex]}
                    onClose={() => setPreviewIndex(null)}
                    onPrev={previewIndex > 0 ? handlePrev : undefined}
                    onNext={previewIndex < items.length - 1 ? handleNext : undefined}
                />
            )}
        </>
    )
}
