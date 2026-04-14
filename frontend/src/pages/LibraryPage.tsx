import { useState, useEffect, useRef, useMemo } from 'react';
import {
    LibraryHeader,
    LibraryFilters,
    ReportsView,
    BackupsCarousel,
    LibraryCards,
    ExportDialog,
    DeleteDialog
} from '@/components/library';
import type {
    Report,
    Backup,
    LibraryCardHandlers,
    BackupFilter,
    SortOption,
    LibraryFilterCounts
} from '@/components/library';
import { useCase } from '@/context/CaseContext';
import { useReports } from '@/context/ReportsContext';
import { API } from '@/lib/api';
import { useToast } from '@/hooks/useToast';
import { useDragScroll } from '@/hooks/useDragScroll';
import { useCaseExport } from '@/hooks/useCaseExport';

type ViewModeValue = 'reports' | 'backups';

export default function LibraryPage() {
    const { selectedCaseId } = useCase();
    const { toast } = useToast();
    const {
        selectedReportId,
        setSelectedReportId,
        filter: reportFilter,
        setFilter: setReportFilter,
        sort: reportSort,
        setSort: setReportSort,
        searchQuery: reportSearchQuery,
        setSearchQuery: setReportSearchQuery,
        saveReportIframeState,
        getReportIframeState,
        isStateLoaded
    } = useReports();

    // Local state for backups
    const [viewMode, setViewMode] = useState<ViewModeValue>('reports');
    const [reports, setReports] = useState<Report[]>([]);
    const [backups, setBackups] = useState<Backup[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [backupFilter, setBackupFilter] = useState<BackupFilter>('all');
    const [backupSort, setBackupSort] = useState<SortOption>('newest');
    const [backupSearchQuery, setBackupSearchQuery] = useState('');
    const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
    const [reportToDelete, setReportToDelete] = useState<Report | null>(null);
    const [backupToDelete, setBackupToDelete] = useState<Backup | null>(null);

    // Export hook
    const {
        exportStatus,
        showExportDialog,
        setShowExportDialog,
        handleExportClick,
        startExport,
        downloadExport,
        resetExport,
    } = useCaseExport(selectedCaseId);

    // Fullscreen state for reports
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Refs
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const carouselContainerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(1200);

    // Drag-to-scroll hook
    const dragScroll = useDragScroll([viewMode, reportFilter, reportSearchQuery, reportSort, backupFilter, backupSearchQuery, backupSort]);

    // Counts
    const counts: LibraryFilterCounts = {
        reportsCount: reports.length,
        backupsCount: backups.filter(b => b.status === 'completed' || !b.status).length,
        ileappCount: reports.filter(r => r.tool === 'ileapp').length,
        aleappCount: reports.filter(r => r.tool === 'aleapp').length,
        iosBackupsCount: backups.filter(b => b.type === 'ios' && (b.status === 'completed' || !b.status)).length,
        androidBackupsCount: backups.filter(b => b.type === 'android' && (b.status === 'completed' || !b.status)).length
    };
    const { reportsCount, backupsCount } = counts;

    // Fetch data
    useEffect(() => {
        const fetchData = async () => {
            try {
                const [reportsRes, backupsRes] = await Promise.all([
                    fetch(selectedCaseId ? API.path(`/reports?case_id=${selectedCaseId}`) : API.path('/reports')),
                    fetch(selectedCaseId ? API.path(`/backups?case_id=${selectedCaseId}`) : API.path('/backups'))
                ]);

                if (reportsRes.ok) {
                    const data = await reportsRes.json();
                    setReports(data);
                }

                if (backupsRes.ok) {
                    const data = await backupsRes.json();
                    setBackups(data);
                }
            } catch (error) {
                console.error('Failed to fetch library data:', error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [selectedCaseId]);

    // Auto-select first report on mount (if no persisted selection)
    useEffect(() => {
        if (!isStateLoaded || isLoading || reports.length === 0) return;

        // If persisted selection exists and is valid, keep it
        if (selectedReportId) {
            const stillExists = reports.find(r => r.id === selectedReportId);
            if (stillExists) return;
        }

        // Otherwise, select first report
        setSelectedReportId(reports[0].id);
    }, [isStateLoaded, isLoading, reports, selectedReportId, setSelectedReportId]);

    // Get selected report
    const selectedReport = reports.find(r => r.id === selectedReportId);

    // Iframe state management - listen for messages from iframe
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Security check - only accept messages from our backend
            if (event.origin !== API.base()) return;

            if (event.data?.type === 'reportState' && selectedReportId !== null) {
                const existingState = getReportIframeState(selectedReportId);

                const newState = {
                    mainScrollY: event.data.mainScrollY,
                    sidebarScrollY: event.data.sidebarScrollY,
                    currentPage: event.data.currentPage,
                    dtStates: {
                        ...(existingState?.dtStates || {}),
                        ...(event.data.dtStates || {})
                    },
                    activeTab: event.data.activeTab
                };

                saveReportIframeState(selectedReportId, newState);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [selectedReportId, getReportIframeState, saveReportIframeState]);

    // Restore iframe state on report switch
    useEffect(() => {
        if (!selectedReport || !iframeRef.current || !selectedReportId) return;

        const savedState = getReportIframeState(selectedReportId);
        if (savedState?.currentPage) {
            // Restore the current page by navigating the iframe
            // This happens after iframe loads, so we need to listen for load event
            const iframe = iframeRef.current;
            const handleLoad = () => {
                if (savedState.currentPage && iframe.src !== API.url(savedState.currentPage)) {
                    // Navigate to the saved page
                    // We'll post a message to the iframe to restore state
                    iframe.contentWindow?.postMessage({
                        type: 'restoreState',
                        state: savedState
                    }, API.base());
                }
            };

            iframe.addEventListener('load', handleLoad);
            return () => iframe.removeEventListener('load', handleLoad);
        }
    }, [selectedReport, selectedReportId, getReportIframeState]);

    // Carousel container width measurement for responsive offsets
    useEffect(() => {
        if (!carouselContainerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            if (entries[0]) {
                setContainerWidth(entries[0].contentRect.width);
            }
        });

        observer.observe(carouselContainerRef.current);

        return () => {
            observer.disconnect();
        };
    }, []);

    // Filter and sort reports
    const filteredReports = useMemo(() => reports
        .filter(r => {
            if (reportFilter !== 'all' && r.tool !== reportFilter) return false;
            if (reportSearchQuery && !r.name.toLowerCase().includes(reportSearchQuery.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => {
            if (reportSort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            if (reportSort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return a.name.localeCompare(b.name);
        }), [reports, reportFilter, reportSearchQuery, reportSort]);

    // Filter and sort backups
    const filteredBackups = useMemo(() => backups
        .filter(b => {
            if (b.status === 'failed' || b.status === 'cancelled' || b.status === 'in_progress') return false;
            if (backupFilter !== 'all' && b.type !== backupFilter) return false;
            if (backupSearchQuery && !b.name.toLowerCase().includes(backupSearchQuery.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => {
            if (backupSort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            if (backupSort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return a.name.localeCompare(b.name);
        }), [backups, backupFilter, backupSearchQuery, backupSort]);

    // Consolidated backup selection reconciler - handles filter changes, view switches, deletions
    useEffect(() => {
        if (viewMode !== 'backups') return;

        // Determine correct selection
        let newSelection: Backup | null = selectedBackup;

        // If current selection not in filtered list, find replacement
        if (selectedBackup && !filteredBackups.find(b => b.id === selectedBackup.id)) {
            newSelection = filteredBackups.length > 0 ? filteredBackups[0] : null;
        }
        // If no selection but items exist, select first
        else if (!selectedBackup && filteredBackups.length > 0) {
            newSelection = filteredBackups[0];
        }
        // If no items at all, ensure null
        else if (filteredBackups.length === 0) {
            newSelection = null;
        }

        // Single state update if needed
        if (newSelection !== selectedBackup) {
            setSelectedBackup(newSelection);
        }
    }, [viewMode, filteredBackups, selectedBackup]);

    // Report handlers
    const handleReportClick = (report: Report) => {
        setSelectedReportId(report.id);
    };

    const handleReportDelete = (report: Report) => {
        setReportToDelete(report);
    };

    const handleReportOpen = (report: Report) => {
        fetch(API.path(`/reports/open?path=${encodeURIComponent(report.path)}`), { method: 'POST' })
            .catch(console.error);
    };

    const executeDeleteReport = async () => {
        if (!reportToDelete) return;

        try {
            const response = await fetch(API.path(`/reports/${reportToDelete.id}`), {
                method: 'DELETE'
            });
            if (response.ok) {
                // Refresh reports
                const reportsRes = await fetch(selectedCaseId ? API.path(`/reports?case_id=${selectedCaseId}`) : API.path('/reports'));
                if (reportsRes.ok) {
                    const data = await reportsRes.json();
                    setReports(data);
                    // Select first remaining report
                    if (data.length > 0) {
                        setSelectedReportId(data[0].id);
                    } else {
                        setSelectedReportId(null);
                    }
                }
                toast({
                    title: "Report Deleted",
                    description: "Report has been removed.",
                });
            }
        } catch (error) {
            console.error('Failed to delete report:', error);
            toast({
                title: "Error",
                description: "Failed to delete report",
                variant: "destructive"
            });
        }
        setReportToDelete(null);
    };

    // Backup handlers
    const handleBackupClick = (backup: Backup) => {
        setSelectedBackup(backup);
    };

    const handleBackupDeleteClick = (backup: Backup) => {
        setBackupToDelete(backup);
    };

    const executeDeleteBackup = async () => {
        if (!backupToDelete) return;

        try {
            const response = await fetch(API.path(`/backups/${backupToDelete.id}`), {
                method: 'DELETE'
            });
            if (response.ok) {
                // Refresh backups
                const backupsRes = await fetch(selectedCaseId ? API.path(`/backups?case_id=${selectedCaseId}`) : API.path('/backups'));
                if (backupsRes.ok) {
                    const data = await backupsRes.json();
                    setBackups(data);
                    // Select first remaining backup
                    const completedBackups = data.filter((b: Backup) => b.status === 'completed' || !b.status);
                    if (completedBackups.length > 0) {
                        setSelectedBackup(completedBackups[0]);
                    } else {
                        setSelectedBackup(null);
                    }
                }
                toast({
                    title: "Backup Deleted",
                    description: "Backup has been removed.",
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
        setBackupToDelete(null);
    };

    const handleBackupOpen = (backup: Backup) => {
        fetch(API.path(`/backups/open?path=${encodeURIComponent(backup.path)}`), { method: 'POST' })
            .catch(console.error);
    };

    const handleBackupDownload = (backup: Backup) => {
        window.location.href = API.path(`/backups/${backup.id}/download`);
    };

    // Library card handlers - unified for both reports and backups
    const libraryCardHandlers: LibraryCardHandlers = {
        open: (item) => {
            if ('tool' in item) {
                handleReportOpen(item);
            } else {
                handleBackupOpen(item);
            }
        },
        download: (item) => {
            if ('type' in item) {
                handleBackupDownload(item);
            }
        },
        delete: (item) => {
            if ('tool' in item) {
                handleReportDelete(item);
            } else {
                handleBackupDeleteClick(item);
            }
        }
    };

    const handleLibraryCardSelect = (item: Report | Backup) => {
        if ('tool' in item) {
            handleReportClick(item);
        } else {
            handleBackupClick(item);
        }
    };

    return (
        <div className={`h-full w-full flex flex-col gap-4 bg-[#151515] text-white overflow-hidden ${isFullscreen ? 'py-0 px-0' : 'py-[3vh] px-[9vh]'}`}>
            {/* Header Bar */}
            {!isFullscreen && (
                <LibraryHeader
                    exportStatus={exportStatus}
                    onExportClick={() => handleExportClick(reportsCount, backupsCount)}
                    viewMode={viewMode}
                    onViewModeChange={setViewMode}
                />
            )}

            {/* Top Section - Content Viewer */}
            <div className="flex-1 min-h-0 relative flex flex-col">
                {/* Reports View */}
                {viewMode === 'reports' && (
                    <ReportsView
                        selectedReport={selectedReport || null}
                        isFullscreen={isFullscreen}
                        onFullscreenToggle={() => setIsFullscreen(!isFullscreen)}
                        iframeRef={iframeRef}
                    />
                )}

                {/* Backups View - Phone Carousel */}
                {viewMode === 'backups' && (
                    <div ref={carouselContainerRef} className="relative h-full z-10">
                        <BackupsCarousel
                            backups={filteredBackups}
                            selectedBackup={selectedBackup}
                            onSelect={setSelectedBackup}
                            onOpen={handleBackupOpen}
                            onDownload={handleBackupDownload}
                            onDelete={handleBackupDeleteClick}
                            containerWidth={containerWidth}
                            searchQuery={backupSearchQuery}
                            filter={backupFilter}
                        />
                    </div>
                )}
            </div>

            {/* Bottom Section - Library */}
            {!isFullscreen && (
                <div className="flex flex-col gap-2 min-h-0">
                    <LibraryFilters
                        viewMode={viewMode}
                        reportFilter={reportFilter}
                        onReportFilterChange={setReportFilter}
                        backupFilter={backupFilter}
                        onBackupFilterChange={setBackupFilter}
                        searchQuery={viewMode === 'reports' ? reportSearchQuery : backupSearchQuery}
                        onSearchChange={viewMode === 'reports' ? setReportSearchQuery : setBackupSearchQuery}
                        sort={viewMode === 'reports' ? reportSort : backupSort}
                        onSortChange={viewMode === 'reports' ? setReportSort : setBackupSort}
                        counts={counts}
                    />

                    <LibraryCards
                        viewMode={viewMode}
                        items={viewMode === 'reports' ? filteredReports : filteredBackups}
                        selectedId={viewMode === 'reports' ? selectedReportId : (selectedBackup?.id || null)}
                        onSelect={handleLibraryCardSelect}
                        handlers={libraryCardHandlers}
                        scrollContainerRef={dragScroll.scrollContainerRef}
                        scrollbarRef={dragScroll.scrollbarRef}
                        isDragging={dragScroll.isDragging}
                        onStartDrag={dragScroll.onMouseDown}
                        onEndDrag={dragScroll.onMouseUp}
                        onDrag={dragScroll.onMouseMove}
                        scrollProgress={dragScroll.scrollProgress}
                        thumbWidth={dragScroll.thumbWidth}
                        isScrollbarDragging={dragScroll.isScrollbarDragging}
                        onScrollbarMouseDown={dragScroll.onScrollbarMouseDown}
                        onScrollbarTrackClick={dragScroll.onScrollbarTrackClick}
                        isLoading={isLoading}
                        searchQuery={viewMode === 'reports' ? reportSearchQuery : backupSearchQuery}
                        filter={viewMode === 'reports' ? reportFilter : backupFilter}
                    />
                </div>
            )}

            {/* Export Dialog */}
            <ExportDialog
                showConfirm={showExportDialog}
                exportStatus={exportStatus}
                reportsCount={reportsCount}
                backupsCount={backupsCount}
                onConfirm={startExport}
                onClose={() => setShowExportDialog(false)}
                onDownload={downloadExport}
                onReset={resetExport}
            />

            {/* Delete confirmation dialog - Reports */}
            <DeleteDialog
                isOpen={!!reportToDelete}
                title="Delete Report"
                itemName={reportToDelete?.name || ''}
                onConfirm={executeDeleteReport}
                onClose={() => setReportToDelete(null)}
            />

            {/* Delete confirmation dialog - Backups */}
            <DeleteDialog
                isOpen={!!backupToDelete}
                title="Delete Backup"
                itemName={backupToDelete?.name || ''}
                onConfirm={executeDeleteBackup}
                onClose={() => setBackupToDelete(null)}
            />
        </div>
    );
}
