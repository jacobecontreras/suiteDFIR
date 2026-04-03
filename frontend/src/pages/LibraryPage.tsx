import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, FileText, FolderOpen, Download, X, Maximize2, Expand, Smartphone, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { PhoneMockup } from '@/components/ui/PhoneMockup';
import { LibraryCard } from '@/components/ui/LibraryCard';
import { useCase } from '@/context/CaseContext';
import { useReports } from '@/context/ReportsContext';
import { API } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import Iphone15Pro from '@/components/ui/shadcn-io/iphone-15-pro';
import AndroidPhone from '@/components/ui/shadcn-io/android-phone';

interface Report {
    id: number;
    name: string;
    path: string;
    url: string;
    tool: 'ileapp' | 'aleapp';
    created_at: string;
    size?: string;
}

interface Backup {
    id: number;
    name: string;
    device_name: string;
    path: string;
    created_at: string;
    size?: string;
    type: 'ios' | 'android';
    status?: string;
}

interface ExportStatus {
    status: 'idle' | 'creating' | 'processing' | 'completed' | 'error';
    jobId?: number;
    progress?: number;
    downloadUrl?: string;
    message?: string;
}

type ViewMode = 'reports' | 'backups';
type BackupFilter = 'all' | 'ios' | 'android';
type SortOption = 'newest' | 'oldest' | 'name';

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
    const [viewMode, setViewMode] = useState<ViewMode>('reports');
    const [reports, setReports] = useState<Report[]>([]);
    const [backups, setBackups] = useState<Backup[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [backupFilter, setBackupFilter] = useState<BackupFilter>('all');
    const [backupSort, setBackupSort] = useState<SortOption>('newest');
    const [backupSearchQuery, setBackupSearchQuery] = useState('');
    const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null);
    const [reportToDelete, setReportToDelete] = useState<Report | null>(null);
    const [backupToDelete, setBackupToDelete] = useState<Backup | null>(null);

    // Export state
    const [exportStatus, setExportStatus] = useState<ExportStatus>({ status: 'idle' });
    const [showExportDialog, setShowExportDialog] = useState(false);

    // Fullscreen state for reports
    const [isFullscreen, setIsFullscreen] = useState(false);

    // Refs
    const eventSourceRef = useRef<EventSource | null>(null);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Carousel refs
    const carouselContainerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(1200);

    // Drag-to-scroll refs
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const scrollbarRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [scrollProgress, setScrollProgress] = useState(0);
    const [thumbWidth, setThumbWidth] = useState(20);
    const [isScrollbarDragging, setIsScrollbarDragging] = useState(false);
    const dragThreshold = 5;
    const dragDistanceRef = useRef(0);

    // Counts
    const reportsCount = reports.length;
    const backupsCount = backups.filter(b => b.status === 'completed' || !b.status).length;
    const ileappCount = reports.filter(r => r.tool === 'ileapp').length;
    const aleappCount = reports.filter(r => r.tool === 'aleapp').length;
    const iosBackupsCount = backups.filter(b => b.type === 'ios' && (b.status === 'completed' || !b.status)).length;
    const androidBackupsCount = backups.filter(b => b.type === 'android' && (b.status === 'completed' || !b.status)).length;

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

                // FAKE BACKUPS FOR TESTING - TODO: Remove this block
                const fakeBackups: Backup[] = Array.from({ length: 20 }, (_, i) => ({
                    id: 1000 + i,
                    name: `Test Backup ${i + 1}`,
                    device_name: i % 2 === 0 ? 'iPhone 15 Pro' : 'Samsung Galaxy S24',
                    path: `/fake/path/backup_${i + 1}`,
                    created_at: new Date(Date.now() - i * 86400000).toISOString(),
                    size: `${(Math.random() * 100 + 10).toFixed(1)} GB`,
                    type: i % 2 === 0 ? 'ios' : 'android',
                    status: 'completed'
                }));
                setBackups(fakeBackups);
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

            if (event.data?.type === 'reportState' && selectedReportId) {
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
        if (!selectedReport || !iframeRef.current) return;

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
    }, [selectedReport, getReportIframeState]);

    // Fullscreen Esc key listener
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isFullscreen) {
                setIsFullscreen(false);
            }
        };

        if (isFullscreen) {
            document.addEventListener('keydown', handleEsc);
            return () => document.removeEventListener('keydown', handleEsc);
        }
    }, [isFullscreen]);

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

    // Track scroll position for custom scrollbar
    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const updateScrollProgress = () => {
            const maxScroll = container.scrollWidth - container.clientWidth;
            if (maxScroll > 0) {
                setScrollProgress(container.scrollLeft / maxScroll);
                setThumbWidth(Math.max(20, (container.clientWidth / container.scrollWidth) * 100));
            } else {
                setScrollProgress(0);
                setThumbWidth(100);
            }
        };

        const resizeObserver = new ResizeObserver(() => {
            updateScrollProgress();
        });

        resizeObserver.observe(container);

        const content = container.firstElementChild;
        if (content) {
            resizeObserver.observe(content);
        }

        container.addEventListener('scroll', updateScrollProgress);
        updateScrollProgress();

        return () => {
            resizeObserver.disconnect();
            container.removeEventListener('scroll', updateScrollProgress);
        };
    }, [viewMode, reportFilter, reportSearchQuery, reportSort, backupFilter, backupSearchQuery, backupSort]);

    // Scrollbar drag handlers
    const thumbOffsetRef = useRef(0);

    const handleScrollbarMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        if (!scrollbarRef.current) return;

        const rect = scrollbarRef.current.getBoundingClientRect();
        const thumbLeftPercent = scrollProgress * (100 - thumbWidth);
        const thumbLeftPx = (thumbLeftPercent / 100) * rect.width;
        const clickPositionInTrack = e.clientX - rect.left;
        thumbOffsetRef.current = clickPositionInTrack - thumbLeftPx;

        setIsScrollbarDragging(true);
    }, [scrollProgress, thumbWidth]);

    useEffect(() => {
        if (!isScrollbarDragging) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!scrollContainerRef.current || !scrollbarRef.current) return;

            const rect = scrollbarRef.current.getBoundingClientRect();
            const trackWidth = rect.width;
            const thumbWidthPx = (thumbWidth / 100) * trackWidth;
            const maxThumbLeft = trackWidth - thumbWidthPx;

            const cursorPositionInTrack = e.clientX - rect.left;
            const targetThumbLeft = cursorPositionInTrack - thumbOffsetRef.current;

            const clampedThumbLeft = Math.max(0, Math.min(maxThumbLeft, targetThumbLeft));

            const maxScroll = scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth;
            const scrollPercentage = maxThumbLeft > 0 ? clampedThumbLeft / maxThumbLeft : 0;
            scrollContainerRef.current.scrollLeft = scrollPercentage * maxScroll;
        };

        const handleMouseUp = () => {
            setIsScrollbarDragging(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isScrollbarDragging, thumbWidth]);

    // Drag-to-scroll handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (!scrollContainerRef.current) return;
        setIsDragging(true);
        setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
        setScrollLeft(scrollContainerRef.current.scrollLeft);
        dragDistanceRef.current = 0;
    }, []);

    const handleMouseLeave = useCallback(() => {
        setIsDragging(false);
        dragDistanceRef.current = 0;
    }, []);

    const handleMouseUp = useCallback((e: React.MouseEvent) => {
        // If drag distance is below threshold, this is a click, let it propagate
        if (dragDistanceRef.current < dragThreshold) {
            // Allow normal click behavior
        }
        setIsDragging(false);
        dragDistanceRef.current = 0;
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging || !scrollContainerRef.current) return;
        e.preventDefault();
        const x = e.pageX - scrollContainerRef.current.offsetLeft;
        const walk = (x - startX) * 1.5;
        scrollContainerRef.current.scrollLeft = scrollLeft - walk;
        dragDistanceRef.current += Math.abs(walk);
    }, [isDragging, startX, scrollLeft]);

    // Filter and sort reports
    const filteredReports = reports
        .filter(r => {
            if (reportFilter !== 'all' && r.tool !== reportFilter) return false;
            if (reportSearchQuery && !r.name.toLowerCase().includes(reportSearchQuery.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => {
            if (reportSort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            if (reportSort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return a.name.localeCompare(b.name);
        });

    // Filter and sort backups
    const filteredBackups = backups
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
        });

    // Carousel index - derived from selected backup position in filtered list
    const carouselIndex = useMemo(() => {
        return filteredBackups.findIndex(b => b.id === selectedBackup?.id);
    }, [filteredBackups, selectedBackup]);

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

    // Export handlers
    const handleExportClick = () => {
        if (!selectedCaseId) {
            toast({
                title: "No Case Selected",
                description: "Please select a case first.",
                variant: "destructive"
            });
            return;
        }

        if (reportsCount === 0 && backupsCount === 0) {
            toast({
                title: "Nothing to Export",
                description: "This case has no reports or completed backups.",
                variant: "destructive"
            });
            return;
        }

        setShowExportDialog(true);
    };

    const startExport = async () => {
        if (!selectedCaseId) return;

        setExportStatus({ status: 'creating', message: 'Creating export job...' });
        setShowExportDialog(false);

        try {
            const response = await fetch(API.path(`/cases/${selectedCaseId}/export`), {
                method: 'POST'
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.detail || 'Failed to create export');
            }

            const data = await response.json();
            const jobId = data.job_id;

            setExportStatus({ status: 'processing', jobId, message: 'Preparing export...' });

            const eventSource = new EventSource(API.path(`/cases/${selectedCaseId}/export/${jobId}/stream`));
            eventSourceRef.current = eventSource;

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'status_update') {
                        if (data.status === 'processing') {
                            setExportStatus({
                                status: 'processing',
                                jobId,
                                progress: data.progress || 0,
                                message: `Processing... ${data.progress || 0}%`
                            });
                        } else if (data.status === 'completed') {
                            setExportStatus({
                                status: 'completed',
                                jobId,
                                downloadUrl: API.path(`/cases/${selectedCaseId}/export/${jobId}/download`),
                                message: 'Export ready!'
                            });
                            eventSource.close();
                        } else if (data.status === 'failed') {
                            setExportStatus({
                                status: 'error',
                                message: 'Export failed. Please try again.'
                            });
                            eventSource.close();
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse SSE message:', e);
                }
            };

            eventSource.onerror = () => {
                eventSource.close();
                if (exportStatus.status !== 'completed') {
                    setExportStatus({
                        status: 'error',
                        message: 'Connection lost. Please check if export completed.'
                    });
                }
            };

        } catch (error) {
            console.error('Export error:', error);
            setExportStatus({
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to start export'
            });
            toast({
                title: "Export Failed",
                description: exportStatus.message,
                variant: "destructive"
            });
        }
    };

    const downloadExport = () => {
        if (exportStatus.downloadUrl) {
            window.location.href = exportStatus.downloadUrl;
            setExportStatus({ status: 'idle' });
        }
    };

    const resetExport = () => {
        setExportStatus({ status: 'idle' });
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
    };

    return (
        <div className={`h-screen w-full flex flex-col gap-4 bg-[#151515] text-white overflow-hidden ${isFullscreen ? 'py-0 px-0' : 'py-[3vh] px-[9vh]'}`}>
            {/* Header Bar */}
            <div className="h-[64px] flex items-center justify-between gap-6 flex-shrink-0">
                {/* Left: Export button */}
                <Button
                    onClick={exportStatus.status === 'idle' ? handleExportClick : undefined}
                    disabled={exportStatus.status === 'creating' || exportStatus.status === 'processing'}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-colors"
                >
                    {exportStatus.status === 'processing' ? (
                        <span className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {exportStatus.progress}%
                        </span>
                    ) : (
                        <span className="flex items-center gap-2">
                            <Download size={16} />
                            Export All
                        </span>
                    )}
                </Button>

                {/* Right: View toggle */}
                <div className="flex items-center gap-1 bg-[#1A1A1A] p-0.5 rounded-lg border border-white/10">
                    <button
                        onClick={() => setViewMode('reports')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            viewMode === 'reports'
                                ? 'bg-white/10 text-white'
                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        Reports
                    </button>
                    <button
                        onClick={() => setViewMode('backups')}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            viewMode === 'backups'
                                ? 'bg-white/10 text-white'
                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                        }`}
                    >
                        Backups
                    </button>
                </div>
            </div>

            {/* Top Section - Content Viewer */}
            <div className="flex-1 min-h-0 relative flex flex-col">
                {/* Reports View */}
                {viewMode === 'reports' && (
                    <>
                        {selectedReport ? (
                            <>
                                {/* Fullscreen toggle button */}
                                <button
                                    onClick={() => setIsFullscreen(!isFullscreen)}
                                    className="absolute bottom-4 right-4 z-20 h-8 w-8 bg-[#1A1A1A]/80 hover:bg-[#252525] border border-white/10 rounded-lg flex items-center justify-center transition-all hover:scale-105 backdrop-blur-sm"
                                    title={isFullscreen ? 'Exit fullscreen' : 'Expand fullscreen'}
                                >
                                    {isFullscreen ? <X size={16} className="text-white" /> : <Maximize2 size={16} className="text-white" />}
                                </button>

                                <div
                                    className={`flex-1 bg-[#1A1A1A] overflow-hidden isolate relative flex flex-col ${isFullscreen ? 'rounded-none' : 'rounded-xl'}`}
                                >
                                    <iframe
                                        ref={iframeRef}
                                        src={selectedReport ? API.url(selectedReport.url) : undefined}
                                        className={`w-full h-full border-none ${isFullscreen ? 'rounded-none' : 'rounded-xl'}`}
                                        title={selectedReport?.name}
                                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                                    />
                                    {!isFullscreen && (
                                        <div className="absolute inset-0 border border-white/10 rounded-xl pointer-events-none z-10" />
                                    )}
                                </div>
                            </>
                        ) : (
                            <div className="flex-1 flex items-center justify-center text-gray-500">
                                <div className="text-center">
                                    <FileText size={48} className="mx-auto mb-3 opacity-30" />
                                    <p className="text-lg">Select a report to view</p>
                                    <p className="text-sm mt-1">Choose from the library below</p>
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* Backups View - Phone Carousel */}
                {viewMode === 'backups' && (
                    <>
                        {filteredBackups.length === 0 ? (
                            <div className="flex-1 flex items-center justify-center text-gray-500">
                                <div className="text-center">
                                    <Smartphone size={48} className="mx-auto mb-3 opacity-20" />
                                    <p className="text-lg">
                                        {backupSearchQuery || backupFilter !== 'all'
                                            ? 'No matching results'
                                            : 'No backups found'}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div
                                ref={carouselContainerRef}
                                className="relative h-full overflow-hidden"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                    if (filteredBackups.length <= 1) return;

                                    if (e.key === 'ArrowLeft') {
                                        e.preventDefault();
                                        const currentIndex = filteredBackups.findIndex(b => b.id === selectedBackup?.id);
                                        const newIndex = currentIndex <= 0 ? filteredBackups.length - 1 : currentIndex - 1;
                                        setSelectedBackup(filteredBackups[newIndex]);
                                    } else if (e.key === 'ArrowRight') {
                                        e.preventDefault();
                                        const currentIndex = filteredBackups.findIndex(b => b.id === selectedBackup?.id);
                                        const newIndex = currentIndex >= filteredBackups.length - 1 ? 0 : currentIndex + 1;
                                        setSelectedBackup(filteredBackups[newIndex]);
                                    }
                                }}
                            >
                                {filteredBackups.map((backup, index) => {
                                    const offset = index - carouselIndex;
                                    const style = getCarouselStyle(offset);
                                    const isCenter = offset === 0;
                                    const isDistant = Math.abs(offset) > 2;

                                    return (
                                        <div
                                            key={backup.id}
                                            className="absolute inset-0 flex items-center justify-center transition-transform duration-500 ease-out transition-opacity duration-500 ease-out motion-reduce:transition-none motion-reduce:duration-0"
                                            style={style}
                                            onClick={() => !isDistant && setSelectedBackup(backup)}
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
                                                                onClick={(e) => { e.stopPropagation(); handleBackupOpen(backup); }}
                                                                className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                                                                title="Open Location"
                                                            >
                                                                <FolderOpen size={17} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleBackupDownload(backup); }}
                                                                className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                                                                title="Download"
                                                            >
                                                                <Download size={17} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleBackupDeleteClick(backup); }}
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
                        )}
                    </>
                )}
            </div>

            {/* Bottom Section - Library */}
            {!isFullscreen && (
                <div className="min-h-[160px] max-h-[240px] flex-shrink-0 flex flex-col gap-0 border border-white/10 rounded-xl bg-[#1A1A1A]/30 overflow-hidden pb-2">
                    <div className="flex-1 flex flex-col gap-2 min-h-0 pb-2 pt-2 px-4">
                        {/* Header with Controls */}
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            {/* Filter buttons */}
                            <div className="flex items-center gap-4">
                                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">
                                    {viewMode === 'reports' ? 'Reports Library' : 'Backups Library'}
                                </label>
                                <div className="flex gap-1 bg-[#1A1A1A] p-0.5 rounded-lg border border-white/10">
                                    {viewMode === 'reports' ? (
                                        <>
                                            <button
                                                onClick={() => setReportFilter('all')}
                                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${reportFilter === 'all' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                            >
                                                All ({reportsCount})
                                            </button>
                                            <button
                                                onClick={() => setReportFilter('ileapp')}
                                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${reportFilter === 'ileapp' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                            >
                                                iLEAPP ({ileappCount})
                                            </button>
                                            <button
                                                onClick={() => setReportFilter('aleapp')}
                                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${reportFilter === 'aleapp' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                            >
                                                aLEAPP ({aleappCount})
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                onClick={() => setBackupFilter('all')}
                                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${backupFilter === 'all' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                            >
                                                All ({backupsCount})
                                            </button>
                                            <button
                                                onClick={() => setBackupFilter('ios')}
                                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${backupFilter === 'ios' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                            >
                                                iOS ({iosBackupsCount})
                                            </button>
                                            <button
                                                onClick={() => setBackupFilter('android')}
                                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${backupFilter === 'android' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                            >
                                                Android ({androidBackupsCount})
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Search and Sort */}
                            <div className="flex gap-2">
                                <div className="relative w-64">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                                    <input
                                        type="text"
                                        placeholder={viewMode === 'reports' ? "Search reports..." : "Search backups..."}
                                        value={viewMode === 'reports' ? reportSearchQuery : backupSearchQuery}
                                        onChange={(e) => viewMode === 'reports' ? setReportSearchQuery(e.target.value) : setBackupSearchQuery(e.target.value)}
                                        className="w-full bg-[#1A1A1A] border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
                                    />
                                </div>
                                <select
                                    value={viewMode === 'reports' ? reportSort : backupSort}
                                    onChange={(e) => viewMode === 'reports' ? setReportSort(e.target.value as SortOption) : setBackupSort(e.target.value as SortOption)}
                                    className="bg-[#1A1A1A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer text-center"
                                >
                                    <option value="newest">Newest First</option>
                                    <option value="oldest">Oldest First</option>
                                    <option value="name">Name (A-Z)</option>
                                </select>
                            </div>
                        </div>

                        {/* Horizontal Scrollable Cards */}
                        <div
                            ref={scrollContainerRef}
                            className={`flex-1 overflow-x-auto overflow-y-hidden min-h-0 [&::-webkit-scrollbar]:hidden ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            onMouseDown={handleMouseDown}
                            onMouseLeave={handleMouseLeave}
                            onMouseUp={handleMouseUp}
                            onMouseMove={handleMouseMove}
                        >
                            {isLoading ? (
                                <div className="h-full flex items-center justify-center text-gray-500 text-sm">Loading...</div>
                            ) : viewMode === 'reports' ? (
                                filteredReports.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                                        {reportSearchQuery || reportFilter !== 'all' ? 'No matching results' : 'No reports found'}
                                    </div>
                                ) : (
                                    <div className="flex gap-3 h-full items-center">
                                        {filteredReports.map((report) => (
                                            <LibraryCard
                                                key={report.id}
                                                data-report-id={report.id}
                                                title={report.name}
                                                isSelected={selectedReportId === report.id}
                                                onClick={() => handleReportClick(report)}
                                                icon={
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img
                                                        src={report.tool === 'ileapp' ? '/apple-logo.svg' : '/android-logo.svg'}
                                                        alt={report.tool}
                                                        className="max-h-full max-w-full object-contain"
                                                        style={{
                                                            filter: report.tool === 'ileapp'
                                                                ? 'invert(1)'
                                                                : 'brightness(0) saturate(100%) invert(80%) sepia(16%) saturate(1088%) hue-rotate(32deg) brightness(92%) contrast(87%)'
                                                        }}
                                                    />
                                                }
                                                subtitle={
                                                    <span className="flex items-center gap-1.5">
                                                        <span className="flex items-center gap-0.5">
                                                            <FileText size={9} />
                                                            <span>{new Date(report.created_at).toLocaleDateString()}</span>
                                                        </span>
                                                        {report.size && (
                                                            <>
                                                                <span>•</span>
                                                                <span>{report.size}</span>
                                                            </>
                                                        )}
                                                    </span>
                                                }
                                                actions={[
                                                    {
                                                        icon: FolderOpen,
                                                        label: 'Open in Finder',
                                                        onClick: () => handleReportOpen(report)
                                                    },
                                                    {
                                                        icon: Trash2,
                                                        label: 'Delete Report',
                                                        variant: 'destructive',
                                                        onClick: () => handleReportDelete(report)
                                                    }
                                                ]}
                                            />
                                        ))}
                                    </div>
                                )
                            ) : (
                                filteredBackups.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                                        {backupSearchQuery || backupFilter !== 'all' ? 'No matching results' : 'No backups found'}
                                    </div>
                                ) : (
                                    <div className="flex gap-3 h-full items-center">
                                        {filteredBackups.map((backup) => (
                                            <LibraryCard
                                                key={backup.id}
                                                data-backup-id={backup.id}
                                                title={backup.name}
                                                isSelected={selectedBackup?.id === backup.id}
                                                onClick={() => handleBackupClick(backup)}
                                                icon={
                                                    /* eslint-disable-next-line @next/next/no-img-element */
                                                    <img
                                                        src={backup.type === 'ios' ? '/apple-logo.svg' : '/android-logo.svg'}
                                                        alt={backup.type}
                                                        className="max-h-full max-w-full object-contain"
                                                        style={{
                                                            filter: backup.type === 'ios'
                                                                ? 'invert(1)'
                                                                : 'brightness(0) saturate(100%) invert(80%) sepia(16%) saturate(1088%) hue-rotate(32deg) brightness(92%) contrast(87%)'
                                                        }}
                                                    />
                                                }
                                                subtitle={
                                                    <span className="flex items-center gap-1.5">
                                                        <span className="flex items-center gap-0.5">
                                                            <Smartphone size={9} />
                                                            <span>{backup.device_name}</span>
                                                        </span>
                                                        <span>•</span>
                                                        <span>{new Date(backup.created_at).toLocaleDateString()}</span>
                                                    </span>
                                                }
                                                actions={[
                                                    {
                                                        icon: FolderOpen,
                                                        label: 'Open Location',
                                                        onClick: () => handleBackupOpen(backup)
                                                    },
                                                    {
                                                        icon: Download,
                                                        label: 'Download',
                                                        onClick: () => handleBackupDownload(backup)
                                                    },
                                                    {
                                                        icon: Trash2,
                                                        label: 'Delete',
                                                        variant: 'destructive',
                                                        onClick: () => handleBackupDeleteClick(backup)
                                                    }
                                                ]}
                                            />
                                        ))}
                                    </div>
                                )
                            )}
                        </div>
                    </div>

                    {/* Custom Minimal Scrollbar */}
                    {(viewMode === 'reports' ? filteredReports : filteredBackups).length > 0 && thumbWidth < 100 && (
                        <div
                            ref={scrollbarRef}
                            className="h-1 bg-white/5 rounded-full mx-4 relative cursor-pointer"
                            onMouseDown={(e) => {
                                if (!scrollContainerRef.current || !scrollbarRef.current) return;
                                const rect = scrollbarRef.current.getBoundingClientRect();
                                const clickX = e.clientX - rect.left;
                                const percentage = clickX / rect.width;
                                const maxScroll = scrollContainerRef.current.scrollWidth - scrollContainerRef.current.clientWidth;
                                scrollContainerRef.current.scrollLeft = percentage * maxScroll;
                            }}
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
                                    handleScrollbarMouseDown(e);
                                }}
                            />
                        </div>
                    )}
                </div>
            )}

            {/* Export Progress Dialog */}
            {exportStatus.status !== 'idle' && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#1A1A1A] border border-[#333333] rounded-xl p-6 max-w-[400px] w-full">
                        <div className="text-center space-y-4">
                            {(exportStatus.status === 'creating' || exportStatus.status === 'processing') && (
                                <Loader2 className="w-12 h-12 text-blue-400 animate-spin mx-auto" />
                            )}
                            {exportStatus.status === 'completed' && (
                                <div className="w-12 h-12 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
                                    <Download className="w-6 h-6 text-green-400" />
                                </div>
                            )}
                            {exportStatus.status === 'error' && (
                                <div className="w-12 h-12 mx-auto rounded-full bg-red-500/20 flex items-center justify-center">
                                    <X className="w-6 h-6 text-red-400" />
                                </div>
                            )}

                            <h3 className="text-sm font-semibold text-white uppercase tracking-wide">
                                {exportStatus.status === 'processing' && 'Exporting Case Data'}
                                {exportStatus.status === 'completed' && 'Export Ready'}
                                {exportStatus.status === 'error' && 'Export Failed'}
                                {(exportStatus.status === 'creating' || exportStatus.status === 'idle') && 'Starting Export'}
                            </h3>

                            <p className="text-sm text-gray-300">
                                {exportStatus.message}
                            </p>

                            {exportStatus.status === 'processing' && exportStatus.progress !== undefined && (
                                <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 transition-all duration-300"
                                        style={{ width: `${exportStatus.progress}%` }}
                                    />
                                </div>
                            )}

                            <div className="flex gap-2">
                                {(exportStatus.status === 'error' || exportStatus.status === 'completed') && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="flex-1 h-8 text-xs bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                                        onClick={resetExport}
                                    >
                                        Close
                                    </Button>
                                )}
                                {exportStatus.status === 'completed' && (
                                    <Button
                                        variant="default"
                                        size="sm"
                                        className="flex-1 h-8 text-xs bg-blue-500 hover:bg-blue-600 text-white"
                                        onClick={downloadExport}
                                    >
                                        Download
                                    </Button>
                                )}
                                {(exportStatus.status === 'creating' || exportStatus.status === 'processing') && (
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        className="w-full h-8 text-xs bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                                        onClick={resetExport}
                                    >
                                        Cancel
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Export Confirmation Dialog */}
            {showExportDialog && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#1A1A1A] border border-[#333333] rounded-xl p-6 max-w-[400px] w-full">
                        <h3 className="text-sm font-semibold text-white tracking-wide uppercase mb-4">Export Case Data</h3>

                        <div className="space-y-3 mb-4">
                            <p className="text-sm text-gray-300">
                                Export all reports and completed backups for this case as a ZIP archive?
                            </p>
                            <div className="bg-[#151515] rounded-lg p-3 space-y-2 text-xs text-gray-400">
                                <div className="flex justify-between">
                                    <span>Reports:</span>
                                    <span className="text-white">{reportsCount}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Backups:</span>
                                    <span className="text-white">{backupsCount}</span>
                                </div>
                            </div>
                            <p className="text-[10px] text-gray-500 italic">
                                This may take a while for large cases. You can navigate away and come back.
                            </p>
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                className="flex-1 h-8 text-xs bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                                onClick={() => setShowExportDialog(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="default"
                                size="sm"
                                className="flex-1 h-8 text-xs bg-blue-500 hover:bg-blue-600 text-white"
                                onClick={startExport}
                            >
                                Start Export
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation dialog - Reports */}
            {reportToDelete && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#1A1A1A] border border-[#333333] rounded-xl p-5 max-w-[340px]">
                        <h3 className="text-sm font-semibold text-white tracking-wide uppercase mb-3">Delete Report</h3>
                        <p className="text-[11px] text-gray-400 mb-4">
                            Are you sure you want to delete <span className="text-white font-medium">{reportToDelete.name}</span>? This action cannot be undone.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                className="flex-1 h-8 text-[11px] bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                                onClick={() => setReportToDelete(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="flex-1 h-8 text-[11px] bg-red-900/20 hover:bg-red-900/40 text-white border border-red-900/30"
                                onClick={executeDeleteReport}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete confirmation dialog - Backups */}
            {backupToDelete && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-[#1A1A1A] border border-[#333333] rounded-xl p-5 max-w-[340px]">
                        <h3 className="text-sm font-semibold text-white tracking-wide uppercase mb-3">Delete Backup</h3>
                        <p className="text-[11px] text-gray-400 mb-4">
                            Are you sure you want to delete <span className="text-white font-medium">{backupToDelete.name}</span>? This action cannot be undone.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                className="flex-1 h-8 text-[11px] bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                                onClick={() => setBackupToDelete(null)}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                className="flex-1 h-8 text-[11px] bg-red-900/20 hover:bg-red-900/40 text-white border border-red-900/30"
                                onClick={executeDeleteBackup}
                            >
                                Delete
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
