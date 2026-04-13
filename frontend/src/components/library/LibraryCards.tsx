import { RefObject, useCallback, useEffect, useState } from 'react';
import { FileText, Smartphone, FolderOpen, Download, Trash2 } from 'lucide-react';
import { LibraryCard } from '@/components/ui/LibraryCard';

export interface Report {
    id: number;
    name: string;
    path: string;
    url: string;
    tool: 'ileapp' | 'aleapp';
    created_at: string;
    size?: string;
}

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

export type LibraryItem = Report | Backup;

export interface LibraryCardHandlers {
    open: (item: LibraryItem) => void;
    download?: (item: LibraryItem) => void;
    delete: (item: LibraryItem) => void;
}

export interface LibraryCardsProps {
    viewMode: 'reports' | 'backups';
    items: LibraryItem[];
    selectedId: number | null;
    onSelect: (item: LibraryItem) => void;
    handlers: LibraryCardHandlers;
    scrollContainerRef: RefObject<HTMLDivElement | null>;
    scrollbarRef: RefObject<HTMLDivElement | null>;
    isDragging: boolean;
    onStartDrag: (e: React.MouseEvent) => void;
    onEndDrag: (e: React.MouseEvent) => void;
    onDrag: (e: React.MouseEvent) => void;
    scrollProgress: number;
    thumbWidth: number;
    isScrollbarDragging: boolean;
    onScrollbarMouseDown: (e: React.MouseEvent) => void;
    onScrollbarTrackClick: (e: React.MouseEvent) => void;
    isLoading: boolean;
    searchQuery: string;
    filter: string;
}

export function LibraryCards({
    viewMode,
    items,
    selectedId,
    onSelect,
    handlers,
    scrollContainerRef,
    scrollbarRef,
    isDragging,
    onStartDrag,
    onEndDrag,
    onDrag,
    scrollProgress,
    thumbWidth,
    isScrollbarDragging,
    onScrollbarMouseDown,
    onScrollbarTrackClick,
    isLoading,
    searchQuery,
    filter
}: LibraryCardsProps) {
    const isEmpty = items.length === 0;
    const showScrollbar = !isEmpty && thumbWidth < 100;

    return (
        <div className="min-h-[160px] max-h-[240px] flex-shrink-0 flex flex-col gap-0 border border-white/10 rounded-xl bg-[#1A1A1A]/30 overflow-hidden pb-2">
            <div className="flex-1 flex flex-col gap-2 min-h-0 pb-2 pt-2 px-4">
                {/* Horizontal Scrollable Cards */}
                <div
                    ref={scrollContainerRef}
                    className={`flex-1 overflow-x-auto overflow-y-hidden min-h-0 [&::-webkit-scrollbar]:hidden ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    onMouseDown={onStartDrag}
                    onMouseLeave={onEndDrag}
                    onMouseUp={onEndDrag}
                    onMouseMove={onDrag}
                >
                    {isLoading ? (
                        <div className="h-full flex items-center justify-center text-gray-500 text-sm">Loading...</div>
                    ) : isEmpty ? (
                        <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                            {searchQuery || filter !== 'all' ? 'No matching results' : `No ${viewMode} found`}
                        </div>
                    ) : (
                        <div className="flex gap-3 h-full items-center">
                            {items.map((item) => {
                                const isReport = viewMode === 'reports';
                                const report = isReport ? (item as Report) : null;
                                const backup = !isReport ? (item as Backup) : null;

                                return (
                                    <LibraryCard
                                        key={item.id}
                                        data-report-id={isReport ? report!.id : undefined}
                                        data-backup-id={!isReport ? backup!.id : undefined}
                                        title={item.name}
                                        isSelected={selectedId === item.id}
                                        onClick={() => onSelect(item)}
                                        icon={
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img
                                                src={
                                                    isReport
                                                        ? (report!.tool === 'ileapp' ? '/apple-logo.svg' : '/android-logo.svg')
                                                        : (backup!.type === 'ios' ? '/apple-logo.svg' : '/android-logo.svg')
                                                }
                                                alt={isReport ? report!.tool : backup!.type}
                                                className="max-h-full max-w-full object-contain"
                                                style={{
                                                    filter:
                                                        isReport
                                                            ? (report!.tool === 'ileapp'
                                                                ? 'invert(1)'
                                                                : 'brightness(0) saturate(100%) invert(80%) sepia(16%) saturate(1088%) hue-rotate(32deg) brightness(92%) contrast(87%)')
                                                            : (backup!.type === 'ios'
                                                                ? 'invert(1)'
                                                                : 'brightness(0) saturate(100%) invert(80%) sepia(16%) saturate(1088%) hue-rotate(32deg) brightness(92%) contrast(87%)')
                                                }}
                                            />
                                        }
                                        subtitle={
                                            isReport ? (
                                                <span className="flex items-center gap-1.5">
                                                    <span className="flex items-center gap-0.5">
                                                        <FileText size={9} />
                                                        <span>{new Date(report!.created_at).toLocaleDateString()}</span>
                                                    </span>
                                                    {report!.size && (
                                                        <>
                                                            <span>•</span>
                                                            <span>{report!.size}</span>
                                                        </>
                                                    )}
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1.5">
                                                    <span className="flex items-center gap-0.5">
                                                        <Smartphone size={9} />
                                                        <span>{backup!.device_name}</span>
                                                    </span>
                                                    <span>•</span>
                                                    <span>{new Date(backup!.created_at).toLocaleDateString()}</span>
                                                </span>
                                            )
                                        }
                                        actions={[
                                            {
                                                icon: FolderOpen,
                                                label: isReport ? 'Open in Finder' : 'Open Location',
                                                onClick: () => handlers.open(item)
                                            },
                                            ...(backup ? [{
                                                icon: Download,
                                                label: 'Download',
                                                onClick: () => handlers.download!(item)
                                            }] : []),
                                            {
                                                icon: Trash2,
                                                label: isReport ? 'Delete Report' : 'Delete',
                                                variant: 'destructive' as const,
                                                onClick: () => handlers.delete(item)
                                            }
                                        ]}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Minimal Scrollbar */}
            {showScrollbar && (
                <div
                    ref={scrollbarRef}
                    className="h-1 bg-white/5 rounded-full mx-4 relative cursor-pointer"
                    onMouseDown={onScrollbarTrackClick}
                >
                    <div
                        className={`absolute top-0 h-full bg-white/30 rounded-full transition-colors hover:bg-white/50 ${isScrollbarDragging ? 'bg-white/50' : ''}`}
                        style={{
                            width: `${thumbWidth}%`,
                            left: `${scrollProgress * (100 - thumbWidth)}%`,
                            cursor: isScrollbarDragging ? 'grabbing' : 'grab',
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            onScrollbarMouseDown(e);
                        }}
                    />
                </div>
            )}
        </div>
    );
}
