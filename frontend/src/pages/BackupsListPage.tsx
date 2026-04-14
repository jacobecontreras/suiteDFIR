import { useState, useEffect, useCallback } from 'react';
import { Search, Smartphone, FolderOpen, Download, Trash2 } from 'lucide-react';
import { LibraryCard } from '@/components/ui/LibraryCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDragScroll } from '@/hooks/useDragScroll';
import { useCase } from '@/context/CaseContext';
import { API } from '@/lib/api';
import { useToast } from '@/hooks/useToast';

interface Backup {
    id: number;
    name: string;
    device_name: string;
    path: string;
    created_at: string;
    status: string;
    type: 'ios' | 'android';
    size?: string;
    progress?: number;
}

export default function BackupsListPage() {
    const [backups, setBackups] = useState<Backup[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'ios' | 'android'>('all');
    const [sort, setSort] = useState<'newest' | 'oldest' | 'name'>('newest');
    const [searchQuery, setSearchQuery] = useState('');
    const { selectedCaseId } = useCase();
    const { toast } = useToast();

    // Dialog hooks for each action
    const { config: deleteConfig, show: showDelete, hide: hideDelete, handleConfirm: handleDeleteConfirm } = useConfirmDialog();
    const { config: openConfig, show: showOpen, hide: hideOpen, handleConfirm: handleOpenConfirm } = useConfirmDialog();
    const { config: downloadConfig, show: showDownload, hide: hideDownload, handleConfirm: handleDownloadConfirm } = useConfirmDialog();

    // Drag-to-scroll hook
    const dragScroll = useDragScroll([backups, filter, searchQuery, sort]);

    const fetchBackups = useCallback(async () => {
        try {
            const url = selectedCaseId
                ? API.path(`/backups?case_id=${selectedCaseId}`)
                : API.path('/backups');
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                setBackups(data);
            }
        } catch (error) {
            console.error('Failed to fetch backups:', error);
        } finally {
            setIsLoading(false);
        }
    }, [selectedCaseId]);

    useEffect(() => {
        fetchBackups();
    }, [selectedCaseId, fetchBackups]);

    const handleOpenClick = (backup: Backup) => {
        showOpen({
            title: 'Open Folder',
            message: `Are you sure you want to open ${backup.name} in Finder?`,
            confirmLabel: 'Open',
            onConfirm: () => executeOpen(backup.path)
        });
    };

    const executeOpen = async (path: string) => {
        try {
            await fetch(API.path(`/backups/open?path=${encodeURIComponent(path)}`), {
                method: 'POST'
            });
        } catch (error) {
            console.error('Failed to open backup:', error);
        }
    };

    const handleDownloadClick = (backup: Backup) => {
        showDownload({
            title: 'Download Backup',
            message: `Are you sure you want to download ${backup.name} as a ZIP archive?`,
            confirmLabel: 'Download',
            onConfirm: () => executeDownload(backup.id)
        });
    };

    const executeDownload = async (backupId: number) => {
        window.location.href = API.path(`/backups/${backupId}/download`);
    };

    const handleDeleteClick = (backup: Backup) => {
        showDelete({
            title: 'Delete Backup',
            message: `Are you sure you want to delete ${backup.name}? This action cannot be undone.`,
            variant: 'destructive',
            confirmLabel: 'Delete',
            onConfirm: () => executeDelete(backup.id)
        });
    };

    const executeDelete = async (backupId: number) => {
        try {
            const response = await fetch(API.path(`/backups/${backupId}`), {
                method: 'DELETE'
            });
            if (response.ok) {
                fetchBackups();
                toast({
                    title: "Backup Deleted",
                    description: "Backup files have been removed.",
                });
            }
        } catch (error) {
            console.error('Failed to delete backup:', error);
            toast({
                title: "Error",
                description: "Failed to delete backup",
                variant: "destructive"
            });
        }
    };

    const filteredBackups = backups
        .filter(b => {
            if (filter !== 'all' && b.type !== filter) return false;
            if (searchQuery && !b.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            // Only show completed backups
            if (b.status !== 'completed') return false;
            return true;
        })
        .sort((a, b) => {
            if (sort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return a.name.localeCompare(b.name);
        });

    const iosCount = backups.filter(b => b.type === 'ios' && b.status === 'completed').length;
    const androidCount = backups.filter(b => b.type === 'android' && b.status === 'completed').length;

    return (
        <div className="h-screen w-full flex flex-col bg-[#151515] text-white py-[3vh] px-[9vh] gap-3">
            {/* Top Section - Header */}
            <div className="flex-shrink-0 flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-wide">Backups</h1>
                    <p className="text-sm text-gray-400 mt-1">
                        {iosCount} iOS • {androidCount} Android
                    </p>
                </div>

                <div className="flex gap-2">
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                        <input
                            type="text"
                            placeholder="Search backups..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-[#1A1A1A] border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
                        />
                    </div>
                    <div className="flex gap-1 bg-[#1A1A1A] p-0.5 rounded-lg border border-white/10">
                        <button
                            onClick={() => setFilter('all')}
                            className={`px-3 py-2 rounded-md text-xs font-medium transition-colors ${filter === 'all' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            All
                        </button>
                        <button
                            onClick={() => setFilter('ios')}
                            className={`px-3 py-2 rounded-md text-xs font-medium transition-colors ${filter === 'ios' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            iOS
                        </button>
                        <button
                            onClick={() => setFilter('android')}
                            className={`px-3 py-2 rounded-md text-xs font-medium transition-colors ${filter === 'android' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                        >
                            Android
                        </button>
                    </div>
                    <select
                        value={sort}
                        onChange={(e) => setSort(e.target.value as 'newest' | 'oldest' | 'name')}
                        className="bg-[#1A1A1A] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer"
                    >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="name">Name (A-Z)</option>
                    </select>
                </div>
            </div>

            {/* Bottom Section - Backup List */}
            <div className="flex-1 flex flex-col gap-0 min-h-0 border border-white/10 rounded-xl bg-[#1A1A1A]/30 overflow-hidden pb-2">
                <div className="flex-1 flex flex-col gap-2 min-h-0 pb-2 pt-2 px-4">
                    {/* Horizontal Scrollable Backup Cards */}
                    <div
                        ref={dragScroll.scrollContainerRef}
                        className={`backup-cards-container flex-1 overflow-x-auto overflow-y-hidden min-h-0 [&::-webkit-scrollbar]:hidden ${dragScroll.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                        onMouseDown={dragScroll.onMouseDown}
                        onMouseLeave={dragScroll.onMouseLeave}
                        onMouseUp={dragScroll.onMouseUp}
                        onMouseMove={dragScroll.onMouseMove}
                    >
                        {isLoading ? (
                            <div className="h-full flex items-center justify-center text-gray-500">Loading...</div>
                        ) : filteredBackups.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-gray-500 text-sm">No backups found</div>
                        ) : (
                            <div className="flex gap-3 h-full items-center">
                                {filteredBackups.map((backup) => (
                                    <LibraryCard
                                        key={backup.id}
                                        data-backup-id={backup.id}
                                        className="backup-card w-72"
                                        title={backup.name}
                                        icon={
                                            backup.type === 'ios' ? (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img
                                                    src="/apple-logo.svg"
                                                    alt="iOS"
                                                    className="w-5 h-5"
                                                    style={{ filter: 'invert(1)' }}
                                                />
                                            ) : (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img
                                                    src="/android-logo.svg"
                                                    alt="Android"
                                                    className="w-5 h-5"
                                                    style={{ filter: 'brightness(0) saturate(100%) invert(80%) sepia(16%) saturate(1088%) hue-rotate(32deg) brightness(92%) contrast(87%)' }}
                                                />
                                            )
                                        }
                                        subtitle={
                                            <span className="flex items-center gap-1.5">
                                                <Smartphone size={9} />
                                                {backup.device_name}
                                            </span>
                                        }
                                        actions={[
                                            {
                                                icon: FolderOpen,
                                                label: 'Open Location',
                                                onClick: () => handleOpenClick(backup)
                                            },
                                            {
                                                icon: Download,
                                                label: 'Download',
                                                onClick: () => handleDownloadClick(backup)
                                            },
                                            {
                                                icon: Trash2,
                                                label: 'Delete Backup',
                                                variant: 'destructive',
                                                onClick: () => handleDeleteClick(backup)
                                            }
                                        ]}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Custom Scrollbar */}
                {filteredBackups.length > 0 && dragScroll.thumbWidth < 100 && (
                    <div
                        ref={dragScroll.scrollbarRef}
                        className="h-1 bg-white/5 rounded-full mx-4 relative cursor-pointer"
                        onMouseDown={dragScroll.onScrollbarTrackClick}
                    >
                        <div
                            className={`absolute top-0 h-full bg-white/30 rounded-full transition-colors hover:bg-white/50 ${dragScroll.isScrollbarDragging ? 'bg-white/50' : ''}`}
                            style={{
                                width: `${dragScroll.thumbWidth}%`,
                                left: `${dragScroll.scrollProgress * (100 - dragScroll.thumbWidth)}%`,
                                cursor: dragScroll.isScrollbarDragging ? 'grabbing' : 'grab',
                            }}
                            onMouseDown={(e) => {
                                e.stopPropagation();
                                dragScroll.onScrollbarMouseDown(e);
                            }}
                        />
                    </div>
                )}
            </div>

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                config={deleteConfig}
                onClose={hideDelete}
                onConfirm={handleDeleteConfirm}
            />

            {/* Open Folder Dialog */}
            <ConfirmDialog
                config={openConfig}
                onClose={hideOpen}
                onConfirm={handleOpenConfirm}
            />

            {/* Download Dialog */}
            <ConfirmDialog
                config={downloadConfig}
                onClose={hideDownload}
                onConfirm={handleDownloadConfirm}
            />
        </div>
    );
}
