import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Smartphone, FolderOpen, Download, Trash2 } from 'lucide-react';
import { PhoneMockup } from '@/components/ui/PhoneMockup';
import Iphone15Pro from '@/components/ui/shadcn-io/iphone-15-pro';
import AndroidPhone from '@/components/ui/shadcn-io/android-phone';

export interface Backup {
    id: number;
    name: string;
    device_name: string;
    path: string;
    created_at: string;
    size?: string;
    type: 'ios' | 'android';
    status?: string;
}

export interface BackupsCarouselProps {
    backups: Backup[];
    selectedBackup: Backup | null;
    onSelect: (backup: Backup) => void;
    onOpen: (backup: Backup) => void;
    onDownload: (backup: Backup) => void;
    onDelete: (backup: Backup) => void;
    containerWidth: number;
    searchQuery: string;
    filter: 'all' | 'ios' | 'android';
}

export function BackupsCarousel({
    backups,
    selectedBackup,
    onSelect,
    onOpen,
    onDownload,
    onDelete,
    containerWidth,
    searchQuery,
    filter
}: BackupsCarouselProps) {
    const carouselContainerRef = useRef<HTMLDivElement>(null);

    // Carousel index - derived from selected backup position in filtered list
    const carouselIndex = useMemo(() => {
        return backups.findIndex(b => b.id === selectedBackup?.id);
    }, [backups, selectedBackup]);

    // Carousel style helper - calculates transform/opacity based on offset from center
    const getCarouselStyle = useCallback((offset: number) => {
        const absOffset = Math.abs(offset);

        // Container-width-based offsets with clamping
        const getTranslateX = (off: number) => {
            if (off === 0) return 0;
            const sign = off > 0 ? 1 : -1;
            if (absOffset === 1) {
                return sign * Math.max(200, Math.min(280, containerWidth * 0.22));
            }
            if (absOffset === 2) {
                return sign * Math.max(380, Math.min(500, containerWidth * 0.40));
            }
            return sign * Math.max(500, Math.min(650, containerWidth * 0.55));
        };

        // Scale and opacity based on distance from center
        let scale = 1.0;
        let opacity = 1.0;
        let zIndex = 10;

        if (absOffset === 0) {
            scale = 1.0;
            opacity = 1.0;
            zIndex = 10;
        } else if (absOffset === 1) {
            scale = 0.75;
            opacity = 0.7;
            zIndex = 5;
        } else if (absOffset === 2) {
            scale = 0.5;
            opacity = 0.4;
            zIndex = 2;
        } else {
            scale = 0.3;
            opacity = 0.15;
            zIndex = 1;
        }

        return {
            transform: `translateX(${getTranslateX(offset)}px) scale(${scale})`,
            opacity,
            zIndex,
            pointerEvents: absOffset > 2 ? ('none' as const) : ('auto' as const),
        };
    }, [containerWidth]);

    // Empty state
    if (backups.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                <div className="text-center">
                    <Smartphone size={48} className="mx-auto mb-3 opacity-20" />
                    <p className="text-lg">
                        {searchQuery || filter !== 'all'
                            ? 'No matching results'
                            : 'No backups found'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={carouselContainerRef}
            className="relative h-full overflow-hidden"
            tabIndex={0}
            onKeyDown={(e) => {
                if (backups.length <= 1) return;

                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    const currentIndex = backups.findIndex(b => b.id === selectedBackup?.id);
                    const newIndex = currentIndex <= 0 ? backups.length - 1 : currentIndex - 1;
                    onSelect(backups[newIndex]);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    const currentIndex = backups.findIndex(b => b.id === selectedBackup?.id);
                    const newIndex = currentIndex >= backups.length - 1 ? 0 : currentIndex + 1;
                    onSelect(backups[newIndex]);
                }
            }}
        >
            {backups.map((backup, index) => {
                const offset = index - carouselIndex;
                const style = getCarouselStyle(offset);
                const isCenter = offset === 0;
                const isDistant = Math.abs(offset) > 2;

                return (
                    <div
                        key={backup.id}
                        className="absolute inset-0 flex items-center justify-center transition-transform duration-500 ease-out transition-opacity duration-500 ease-out motion-reduce:transition-none motion-reduce:duration-0"
                        style={style}
                        onClick={() => !isDistant && onSelect(backup)}
                        tabIndex={isDistant ? -1 : 0}
                        aria-hidden={isDistant}
                    >
                        {isCenter ? (
                            <div className="relative flex flex-col items-center justify-center -mt-20">
                                {/* Info Panel - above phone */}
                                <div className="flex flex-col items-center gap-3 z-10 mb-4">
                                    {/* Info */}
                                    <div className="text-center">
                                        <div className="text-[15px] font-medium text-white truncate">{backup.name}</div>
                                        <div className="text-[12px] text-gray-400 truncate flex items-center justify-center gap-1.5">
                                            <Smartphone size={11} className="flex-shrink-0" />
                                            <span>{backup.device_name}</span>
                                        </div>
                                    </div>
                                    {/* Actions */}
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onOpen(backup); }}
                                            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                                            title="Open Location"
                                        >
                                            <FolderOpen size={17} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onDownload(backup); }}
                                            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                                            title="Download"
                                        >
                                            <Download size={17} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onDelete(backup); }}
                                            className="p-1.5 rounded hover:bg-red-900/30 text-gray-400 hover:text-red-400 transition-colors"
                                            title="Delete"
                                        >
                                            <Trash2 size={17} />
                                        </button>
                                    </div>
                                </div>
                                <PhoneMockup type={backup.type} />
                            </div>
                        ) : (
                            <div className="relative flex-shrink-0">
                                {backup.type === 'ios' ? (
                                    <Iphone15Pro className="h-[45vh] max-h-[380px] w-auto drop-shadow-2xl">
                                        <div className="h-full w-full bg-black" />
                                    </Iphone15Pro>
                                ) : (
                                    <AndroidPhone className="h-[45vh] max-h-[380px] w-auto drop-shadow-2xl">
                                        <div className="h-full w-full bg-black" />
                                    </AndroidPhone>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
