import { useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { API } from '@/lib/api'
import { PhotoMetadataPanel } from './PhotoMetadataPanel'
import type { PhotoItem, PhotoSearchResult } from '@/types/photos'

interface PhotoPreviewModalProps {
    item: PhotoItem | PhotoSearchResult
    onClose: () => void
    onPrev?: () => void
    onNext?: () => void
}

export function PhotoPreviewModal({ item, onClose, onPrev, onNext }: PhotoPreviewModalProps) {
    // Keyboard navigation
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') onClose()
        if (e.key === 'ArrowLeft') onPrev?.()
        if (e.key === 'ArrowRight') onNext?.()
    }, [onClose, onPrev, onNext])

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])

    const score = 'score' in item ? (item as PhotoSearchResult).score : null

    return (
        <div className="fixed inset-0 z-50 bg-black/90 flex" onClick={onClose}>
            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 p-2 text-gray-400 hover:text-white transition-colors"
            >
                <X className="h-5 w-5" />
            </button>

            {/* Nav arrows */}
            {onPrev && (
                <button
                    onClick={(e) => { e.stopPropagation(); onPrev() }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-2 text-gray-400 hover:text-white transition-colors"
                >
                    <ChevronLeft className="h-8 w-8" />
                </button>
            )}
            {onNext && (
                <button
                    onClick={(e) => { e.stopPropagation(); onNext() }}
                    className="absolute right-80 top-1/2 -translate-y-1/2 z-10 p-2 text-gray-400 hover:text-white transition-colors"
                >
                    <ChevronRight className="h-8 w-8" />
                </button>
            )}

            {/* Image area */}
            <div
                className="flex-1 flex items-center justify-center p-12"
                onClick={(e) => e.stopPropagation()}
            >
                <img
                    src={API.url(item.full_url)}
                    alt=""
                    className="max-w-full max-h-full object-contain rounded"
                />
            </div>

            {/* Metadata sidebar */}
            <div
                className="w-72 bg-[#141414] border-l border-[#222222] overflow-y-auto flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
            >
                <PhotoMetadataPanel metadata={item.metadata} score={score} />
            </div>
        </div>
    )
}
