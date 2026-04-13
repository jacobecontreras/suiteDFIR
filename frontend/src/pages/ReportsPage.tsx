import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, FileText, FolderOpen, Download, Trash2, X, Maximize2 } from 'lucide-react';
import { Button, LoadingPage, LibraryCard } from '@/components/ui/index';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDragScroll } from '@/hooks/useDragScroll';
import { useCase } from "@/context/CaseContext";
import { ReportsProvider, useReports, ReportIframeState } from '@/context/ReportsContext';
import { useSearchParams } from 'react-router-dom';
import { Suspense } from 'react';
import { API } from '@/lib/api';


interface Report {
    id: number;
    name: string;
    path: string;
    url: string;
    tool: 'ileapp' | 'aleapp';
    created_at: string;
    size: string;
    artifact_count: number;
}

export default function Reports() {
    return (
        <Suspense fallback={<LoadingPage />}>
            <ReportsContent />
        </Suspense>
    );
}

function ReportsContent() {
    const [reports, setReports] = useState<Report[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const { selectedCaseId } = useCase();

    // Dialog hooks for each action
    const { config: deleteConfig, show: showDelete, hide: hideDelete, handleConfirm: handleDeleteConfirm } = useConfirmDialog();
    const { config: openConfig, show: showOpen, hide: hideOpen, handleConfirm: handleOpenConfirm } = useConfirmDialog();
    const { config: downloadConfig, show: showDownload, hide: hideDownload, handleConfirm: handleDownloadConfirm } = useConfirmDialog();
    const [searchParams] = useSearchParams();

    // Use context for persistent state
    const {
        selectedReportId,
        setSelectedReportId,
        filter,
        setFilter,
        sort,
        setSort,
        searchQuery,
        setSearchQuery,
        saveReportScrollPosition,
        getReportScrollPosition,
        saveReportIframeState,
        getReportIframeState,
        isStateLoaded
    } = useReports();

    // Derive selectedReport from reports and selectedReportId
    const selectedReport = reports.find(r => r.id === selectedReportId) || null;

    // State-driven iframe URL (to restore artifact page)
    const [iframeUrl, setIframeUrl] = useState<string | null>(() => {
        if (selectedReportId) {
            const saved = getReportIframeState(selectedReportId);
            if (saved?.currentPage) return API.url(saved.currentPage);
        }
        return null;
    });

    // Drag-to-scroll hook
    const dragScroll = useDragScroll([reports, filter, searchQuery, sort]);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    // Track the previous report ID for saving scroll position on switch
    const previousReportIdRef = useRef<number | null>(null);
    const restorationInProgressRef = useRef<boolean>(false);
    const pendingScrollRestoreRef = useRef<number | null>(null);
    // Enhanced state restoration (includes sidebar scroll and current page)
    const pendingIframeRestoreRef = useRef<ReportIframeState | null>(null);
    // Track which report ID a pending state save should go to (fixes race condition)
    const pendingStateSaveIdRef = useRef<number | null>(null);

    const fetchReports = useCallback(async () => {
        try {
            const url = selectedCaseId
                ? API.path(`/reports?case_id=${selectedCaseId}`)
                : API.path('/reports');
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                setReports(data);
            }
        } catch (error) {
            console.error('Failed to fetch reports:', error);
        } finally {
            setIsLoading(false);
        }
    }, [selectedCaseId]);

    useEffect(() => {
        fetchReports();
    }, [selectedCaseId, fetchReports]);

    // Handle report selection logic (Deep Linking + Defaults)
    useEffect(() => {
        // Wait for reports to load AND persistent state to be restored
        if (isLoading || reports.length === 0 || !isStateLoaded) {
            return;
        }

        const urlPath = searchParams.get('path'); // We can still support path in URL if needed, but it's better to use ID
        const urlId = searchParams.get('id');

        // 1. Priority: URL ID
        if (urlId) {
            const targetId = parseInt(urlId);
            const targetReport = reports.find(r => r.id === targetId);
            if (targetReport && targetReport.id !== selectedReportId) {
                setSelectedReportId(targetReport.id);
                return;
            }
        }

        // 2. Legacy: URL path (lookup by path)
        if (urlPath) {
            const normalizedUrlPath = urlPath.replace(/\/$/, '').toLowerCase();
            const targetReport = reports.find(r => r.path.replace(/\/$/, '').toLowerCase() === normalizedUrlPath);

            if (targetReport && targetReport.id !== selectedReportId) {
                setSelectedReportId(targetReport.id);
                // Scroll to the selected report card
                setTimeout(() => {
                    const el = document.querySelector(`[data-report-id="${targetReport.id}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                }, 100);
                return;
            }
        }

        // 3. Fallback: Keep current selection if it still exists (from context)
        if (selectedReportId) {
            const stillExists = reports.find(r => r.id === selectedReportId);
            if (stillExists) {
                return;
            }
        }

        // 4. Last Fallback: First report (only if different from current selection)
        if (reports.length > 0 && reports[0].id !== selectedReportId) {
            setSelectedReportId(reports[0].id);
        }
    }, [reports, searchParams, isLoading, selectedReportId, setSelectedReportId, isStateLoaded]);

    // Listen for scroll messages from iframe (enhanced state)
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            // Security check - only accept messages from our backend
            if (event.origin !== API.base()) return;

            // Handle enhanced reportState messages
            if (event.data?.type === 'reportState') {
                // Use pending save ID if set (for state captured before switch)
                // Otherwise use current selectedReportId (for continuous scroll tracking)
                const targetId = pendingStateSaveIdRef.current || selectedReportId;
                if (targetId) {
                    const existingState = getReportIframeState(targetId);

                    let newState = {
                        mainScrollY: event.data.mainScrollY,
                        sidebarScrollY: event.data.sidebarScrollY,
                        currentPage: event.data.currentPage,
                        dtStates: {
                            ...(existingState?.dtStates || {}),
                            ...(event.data.dtStates || {})
                        },
                        activeTab: event.data.activeTab
                    };

                    // Race condition fix: If we are in the middle of restoring state,
                    // and the incoming update says "Page 0" (default initialization),
                    // but we have a saved state saying "Page X", IGNORE the "Page 0" update.
                    if (restorationInProgressRef.current && existingState?.dtStates) {
                        const currentPageUrl = event.data.currentPage;
                        const existingDtState = existingState.dtStates[currentPageUrl];
                        const incomingDtState = event.data.dtStates?.[currentPageUrl];

                        if (existingDtState && incomingDtState &&
                            existingDtState.pageNum > 0 && incomingDtState.pageNum === 0) {
                            newState.dtStates[currentPageUrl].pageNum = existingDtState.pageNum;
                        }
                    }

                    saveReportIframeState(targetId, newState);
                    // Also save to legacy scroll position for backwards compatibility
                    saveReportScrollPosition(targetId, event.data.mainScrollY);
                }
                // Clear pending save ID after use
                pendingStateSaveIdRef.current = null;
            }

            // Legacy scroll message support
            if (event.data?.type === 'scroll' && selectedReportId) {
                saveReportScrollPosition(selectedReportId, event.data.scrollY);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [selectedReportId, saveReportScrollPosition, saveReportIframeState]);

    // Consolidated effect: When switching reports, update URL and restore state
    useEffect(() => {
        if (!selectedReport) return;

        const reportId = selectedReport.id;

        // Update URL if report changed or not set yet
        if (reportId !== previousReportIdRef.current || !iframeUrl) {
            // Default to report base URL
            let targetUrl = API.url(selectedReport.url);
            let restoreIframeState = null;
            let restoreScroll = null;

            // Try enhanced state first (session-based with sidebar scroll)
            const savedIframeState = getReportIframeState(reportId);
            if (savedIframeState && savedIframeState.currentPage) {
                restoreIframeState = savedIframeState;
                // Use saved artifact page
                targetUrl = API.url(savedIframeState.currentPage);
            } else {
                // Fallback to legacy scroll position
                const savedScroll = getReportScrollPosition(reportId);
                if (savedScroll > 0) {
                    restoreScroll = savedScroll;
                }
            }

            pendingIframeRestoreRef.current = restoreIframeState;
            pendingScrollRestoreRef.current = restoreScroll;
            previousReportIdRef.current = reportId;
            restorationInProgressRef.current = true; // Flag that we expect a restore

            setIframeUrl(targetUrl);
        }
    }, [selectedReport, iframeUrl, getReportIframeState, getReportScrollPosition]);

    // Restore scroll/state when iframe loads
    const handleIframeLoad = useCallback(() => {
        if (!iframeRef.current) return;

        // Restore enhanced state (with sidebar scroll)
        if (pendingIframeRestoreRef.current !== null) {
            const state = pendingIframeRestoreRef.current;
            pendingIframeRestoreRef.current = null;
            pendingScrollRestoreRef.current = null;

            setTimeout(() => {
                iframeRef.current?.contentWindow?.postMessage(
                    {
                        type: 'restoreState',
                        mainScrollY: state.mainScrollY,
                        sidebarScrollY: state.sidebarScrollY,
                        dtStates: state.dtStates,
                        activeTab: state.activeTab
                    },
                    API.base()
                );
                // Mark restoration as complete after a short buffer
                setTimeout(() => {
                    restorationInProgressRef.current = false;
                }, 300);
            }, 150);
            return;
        }

        // Fallback: restore legacy scroll position
        if (pendingScrollRestoreRef.current !== null) {
            const scrollY = pendingScrollRestoreRef.current;
            pendingScrollRestoreRef.current = null;

            setTimeout(() => {
                iframeRef.current?.contentWindow?.postMessage(
                    { type: 'scrollTo', scrollY },
                    API.base()
                );
            }, 100);
        }
    }, []);



    const handleOpenClick = (report: Report) => {
        showOpen({
            title: 'Open Folder',
            message: `Are you sure you want to open ${report.name} in Finder?`,
            confirmLabel: 'Open',
            onConfirm: () => executeOpen(report.id)
        });
    };

    const executeOpen = async (reportId: number) => {
        try {
            await fetch(API.path(`/reports/${reportId}/open`), {
                method: 'POST'
            });
        } catch (error) {
            console.error('Failed to open report:', error);
        }
    };

    const handleDownloadClick = (report: Report) => {
        showDownload({
            title: 'Download Report',
            message: `Are you sure you want to download ${report.name} as a ZIP archive?`,
            confirmLabel: 'Download',
            onConfirm: () => executeDownload(report.id)
        });
    };

    const executeDownload = async (reportId: number) => {
        window.location.href = API.path(`/reports/${reportId}/download`);
    };

    const handleDeleteClick = (report: Report) => {
        showDelete({
            title: 'Delete Report',
            message: `Are you sure you want to delete ${report.name}? This action cannot be undone.`,
            variant: 'destructive',
            confirmLabel: 'Delete',
            onConfirm: () => executeDelete(report.id)
        });
    };

    const executeDelete = async (reportId: number) => {
        try {
            const response = await fetch(API.path(`/reports/${reportId}`), {
                method: 'DELETE'
            });
            if (response.ok) {
                // If deleted report was selected, clear selection
                if (selectedReportId === reportId) {
                    setSelectedReportId(null);
                }
                fetchReports(); // Refresh list
            }
        } catch (error) {
            console.error('Failed to delete report:', error);
        }
    };

    const handleViewReport = (report: Report) => {
        // Save current report's state before switching
        if (selectedReportId && iframeRef.current) {
            // Set pending ID so async response saves to correct report
            pendingStateSaveIdRef.current = selectedReportId;
            // Request current state (including sidebar scroll, currentPage) from iframe
            iframeRef.current.contentWindow?.postMessage(
                { type: 'getState' },
                API.base()
            );
        }
        setSelectedReportId(report.id);
    };

    const filteredReports = reports
        .filter(r => {
            if (filter !== 'all' && r.tool !== filter) return false;
            if (searchQuery && !r.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        })
        .sort((a, b) => {
            if (sort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            return a.name.localeCompare(b.name);
        });

    return (
        <div className={`h-screen w-full flex flex-col bg-[#151515] text-white ${isFullscreen ? 'p-0' : 'py-[3vh] px-[9vh]'} gap-3`}>
            {/* Top Section - Report Viewer (85% of available height) */}
            <div className={`${isFullscreen ? 'h-screen' : 'flex-[85]'} flex flex-col min-h-0 relative`}>
                {/* Expand/Collapse Button */}
                {selectedReport && (
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="absolute bottom-4 right-4 z-20 h-8 w-8 bg-[#1A1A1A]/80 hover:bg-[#252525] border border-white/10 rounded-lg flex items-center justify-center transition-all hover:scale-105 backdrop-blur-sm"
                        title={isFullscreen ? 'Exit fullscreen' : 'Expand fullscreen'}
                    >
                        {isFullscreen ? (
                            <X size={16} className="text-white" />
                        ) : (
                            <Maximize2 size={16} className="text-white" />
                        )}
                    </button>
                )}

                {selectedReport ? (
                    <div
                        className={`flex-1 bg-[#1A1A1A] overflow-hidden isolate relative ${isFullscreen ? 'rounded-none' : 'rounded-xl'}`}
                        style={{ WebkitMaskImage: isFullscreen ? 'none' : '-webkit-radial-gradient(white, black)' }}
                    >
                        <iframe
                            ref={iframeRef}
                            src={iframeUrl || API.url(selectedReport.url)}
                            className={`w-full h-full border-none ${isFullscreen ? 'rounded-none' : 'rounded-xl'}`}
                            title={selectedReport.name}
                            onLoad={handleIframeLoad}
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
                        />
                        {/* Border Overlay - physically blocks corner artifacts */}
                        {!isFullscreen && (
                            <div className="absolute inset-0 border border-white/10 rounded-xl pointer-events-none z-10" />
                        )}
                    </div>
                ) : (
                    <div className="flex-1 bg-[#1A1A1A] rounded-lg flex items-center justify-center text-gray-500">
                        <div className="text-center">
                            <p className="text-lg">Select a report to view</p>
                            <p className="text-sm mt-1">Choose from the reports below</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Section - Report List (15% of available height) - Hidden in fullscreen */}
            {!isFullscreen && (
                <div className="flex-[15] flex flex-col gap-0 min-h-[140px] border border-white/10 rounded-xl bg-[#1A1A1A]/30 overflow-hidden pb-2">
                    <div className="flex-1 flex flex-col gap-2 min-h-0 pb-2 pt-2 px-4">
                        {/* Header with Controls */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Reports Library</label>
                                <div className="flex gap-1 bg-[#1A1A1A] p-0.5 rounded-lg border border-white/10">
                                    <button
                                        onClick={() => setFilter('all')}
                                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === 'all' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        All ({reports.length})
                                    </button>
                                    <button
                                        onClick={() => setFilter('ileapp')}
                                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === 'ileapp' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        iLEAPP ({reports.filter(r => r.tool === 'ileapp').length})
                                    </button>
                                    <button
                                        onClick={() => setFilter('aleapp')}
                                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === 'aleapp' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                                    >
                                        aLEAPP ({reports.filter(r => r.tool === 'aleapp').length})
                                    </button>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <div className="relative w-64">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                                    <input
                                        type="text"
                                        placeholder="Search reports..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="w-full bg-[#1A1A1A] border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
                                    />
                                </div>
                                <select
                                    value={sort}
                                    onChange={(e) => setSort(e.target.value as 'newest' | 'oldest' | 'name')}
                                    className="bg-[#1A1A1A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer text-center"
                                >
                                    <option value="newest">Newest First</option>
                                    <option value="oldest">Oldest First</option>
                                    <option value="name">Name (A-Z)</option>
                                </select>
                            </div>
                        </div>

                        {/* Horizontal Scrollable Report Cards */}
                        <div
                            ref={dragScroll.scrollContainerRef}
                            className={`report-cards-container flex-1 overflow-x-auto overflow-y-hidden min-h-0 [&::-webkit-scrollbar]:hidden ${dragScroll.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            onMouseDown={dragScroll.onMouseDown}
                            onMouseLeave={dragScroll.onMouseLeave}
                            onMouseUp={dragScroll.onMouseUp}
                            onMouseMove={dragScroll.onMouseMove}
                        >
                            {isLoading ? (
                                <LoadingPage />
                            ) : filteredReports.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-gray-500 text-sm">No reports found</div>
                            ) : (
                                <div className="flex gap-3 h-full items-center">
                                    {filteredReports.map((report) => (
                                        <LibraryCard
                                            key={report.id}
                                            data-report-id={report.id}
                                            className="report-card w-72"
                                            title={report.name}
                                            isSelected={selectedReportId === report.id}
                                            onClick={() => handleViewReport(report)}
                                            icon={
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img
                                                    src={report.tool === 'ileapp' ? '/apple-logo.svg' : '/android-logo.svg'}
                                                    alt={report.tool}
                                                    className="max-h-full max-w-full object-contain"
                                                    style={{
                                                        filter: report.tool === 'ileapp'
                                                            ? 'brightness(0) invert(1)' // White for Apple
                                                            : 'brightness(0) saturate(100%) invert(80%) sepia(16%) saturate(1088%) hue-rotate(32deg) brightness(92%) contrast(87%)' // #a6c43b for Android
                                                    }}
                                                />
                                            }
                                            subtitle={
                                                <span className="flex items-center gap-1.5 shrink-0">
                                                    <span className="flex items-center gap-0.5 shrink-0">
                                                        <FileText size={9} className="shrink-0" />
                                                        <span>{new Date(report.created_at).toLocaleDateString()}</span>
                                                    </span>
                                                    <span className="shrink-0">•</span>
                                                    <span className="shrink-0">{report.size}</span>
                                                </span>
                                            }
                                            actions={[
                                                {
                                                    icon: FolderOpen,
                                                    label: 'Open in Finder',
                                                    onClick: () => handleOpenClick(report)
                                                },
                                                {
                                                    icon: Trash2,
                                                    label: 'Delete Report',
                                                    variant: 'destructive',
                                                    onClick: () => handleDeleteClick(report)
                                                }
                                            ]}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Custom Minimal Scrollbar - Moved Outside Red Container */}
                    {filteredReports.length > 0 && dragScroll.thumbWidth < 100 && (
                        <div
                            ref={dragScroll.scrollbarRef}
                            className="h-1 bg-white/5 rounded-full mx-4 relative cursor-pointer"
                            onMouseDown={dragScroll.onScrollbarTrackClick}
                        >
                            {/* Scrollbar Thumb */}
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
            )}

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
