import { useState, useEffect, useCallback } from 'react';
import { X, Maximize2 } from 'lucide-react';
import { LoadingPage } from '@/components/ui/index';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useCase } from "@/context/CaseContext";
import { useReports } from '@/context/ReportsContext';
import { useReportIframeState } from '@/hooks/useReportIframeState';
import { useSearchParams } from 'react-router-dom';
import { Suspense } from 'react';
import { API } from '@/lib/api';
import { Report } from '@/types/report';
import ReportsLibrary from '@/components/reports/ReportsLibrary';

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

    const { config: deleteConfig, show: showDelete, hide: hideDelete, handleConfirm: handleDeleteConfirm } = useConfirmDialog();
    const { config: openConfig, show: showOpen, hide: hideOpen, handleConfirm: handleOpenConfirm } = useConfirmDialog();
    const { config: downloadConfig, hide: hideDownload, handleConfirm: handleDownloadConfirm } = useConfirmDialog();
    const [searchParams] = useSearchParams();

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

    const selectedReport = reports.find(r => r.id === selectedReportId) || null;

    const { iframeRef, iframeUrl, handleIframeLoad, handleViewReport } = useReportIframeState({
        selectedReport,
        selectedReportId,
        setSelectedReportId,
        getReportIframeState,
        saveReportIframeState,
        getReportScrollPosition,
        saveReportScrollPosition,
    });

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

    // Deep linking + default selection
    useEffect(() => {
        if (isLoading || reports.length === 0 || !isStateLoaded) return;

        const urlId = searchParams.get('id');
        if (urlId) {
            const targetId = parseInt(urlId);
            const targetReport = reports.find(r => r.id === targetId);
            if (targetReport && targetReport.id !== selectedReportId) {
                setSelectedReportId(targetReport.id);
                return;
            }
        }

        const urlPath = searchParams.get('path');
        if (urlPath) {
            const normalizedUrlPath = urlPath.replace(/\/$/, '').toLowerCase();
            const targetReport = reports.find(r => r.path.replace(/\/$/, '').toLowerCase() === normalizedUrlPath);
            if (targetReport && targetReport.id !== selectedReportId) {
                setSelectedReportId(targetReport.id);
                setTimeout(() => {
                    const el = document.querySelector(`[data-report-id="${targetReport.id}"]`);
                    if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                    }
                }, 100);
                return;
            }
        }

        if (selectedReportId) {
            const stillExists = reports.find(r => r.id === selectedReportId);
            if (stillExists) return;
        }

        if (reports.length > 0 && reports[0].id !== selectedReportId) {
            setSelectedReportId(reports[0].id);
        }
    }, [reports, searchParams, isLoading, selectedReportId, setSelectedReportId, isStateLoaded]);

    // Action handlers
    const handleOpenClick = (report: Report) => {
        showOpen({
            title: 'Open Folder',
            message: `Are you sure you want to open ${report.name} in Finder?`,
            confirmLabel: 'Open',
            onConfirm: async () => {
                try {
                    await fetch(API.path(`/reports/${report.id}/open`), { method: 'POST' });
                } catch (error) {
                    console.error('Failed to open report:', error);
                }
            }
        });
    };

    const handleDeleteClick = (report: Report) => {
        showDelete({
            title: 'Delete Report',
            message: `Are you sure you want to delete ${report.name}? This action cannot be undone.`,
            variant: 'destructive',
            confirmLabel: 'Delete',
            onConfirm: async () => {
                try {
                    const response = await fetch(API.path(`/reports/${report.id}`), { method: 'DELETE' });
                    if (response.ok) {
                        if (selectedReportId === report.id) {
                            setSelectedReportId(null);
                        }
                        fetchReports();
                    }
                } catch (error) {
                    console.error('Failed to delete report:', error);
                }
            }
        });
    };

    return (
        <div className={`h-screen w-full flex flex-col bg-[#151515] text-white ${isFullscreen ? 'p-0' : 'py-[3vh] px-[9vh]'} gap-3`}>
            {/* Report Viewer */}
            <div className={`${isFullscreen ? 'h-screen' : 'flex-[85]'} flex flex-col min-h-0 relative`}>
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

            {/* Report Library */}
            {!isFullscreen && (
                <ReportsLibrary
                    reports={reports}
                    isLoading={isLoading}
                    selectedReportId={selectedReportId}
                    filter={filter}
                    sort={sort}
                    searchQuery={searchQuery}
                    setFilter={setFilter}
                    setSort={setSort}
                    setSearchQuery={setSearchQuery}
                    onViewReport={handleViewReport}
                    onOpenClick={handleOpenClick}
                    onDeleteClick={handleDeleteClick}
                />
            )}

            {/* Confirmation Dialogs */}
            <ConfirmDialog config={deleteConfig} onClose={hideDelete} onConfirm={handleDeleteConfirm} />
            <ConfirmDialog config={openConfig} onClose={hideOpen} onConfirm={handleOpenConfirm} />
            <ConfirmDialog config={downloadConfig} onClose={hideDownload} onConfirm={handleDownloadConfirm} />
        </div>
    );
}
