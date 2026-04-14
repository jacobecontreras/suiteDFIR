import { useState, useRef, useEffect, useCallback } from 'react';
import { ReportIframeState } from '@/context/ReportsContext';
import { Report } from '@/types/report';
import { API } from '@/lib/api';

interface UseReportIframeStateOptions {
    selectedReport: Report | null;
    selectedReportId: number | null;
    setSelectedReportId: (id: number | null) => void;
    getReportIframeState: (reportId: number) => ReportIframeState | null;
    saveReportIframeState: (reportId: number, state: ReportIframeState) => void;
    getReportScrollPosition: (reportId: number) => number;
    saveReportScrollPosition: (reportId: number, scrollY: number) => void;
}

export function useReportIframeState({
    selectedReport,
    selectedReportId,
    setSelectedReportId,
    getReportIframeState,
    saveReportIframeState,
    getReportScrollPosition,
    saveReportScrollPosition,
}: UseReportIframeStateOptions) {
    const [iframeUrl, setIframeUrl] = useState<string | null>(() => {
        if (selectedReportId) {
            const saved = getReportIframeState(selectedReportId);
            if (saved?.currentPage) return API.url(saved.currentPage);
        }
        return null;
    });

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const previousReportIdRef = useRef<number | null>(null);
    const restorationInProgressRef = useRef<boolean>(false);
    const pendingScrollRestoreRef = useRef<number | null>(null);
    const pendingIframeRestoreRef = useRef<ReportIframeState | null>(null);
    const pendingStateSaveIdRef = useRef<number | null>(null);

    // Listen for scroll/state messages from iframe
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== API.base()) return;

            if (event.data?.type === 'reportState') {
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

                    // Race condition fix: ignore default "Page 0" during restoration
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
                    saveReportScrollPosition(targetId, event.data.mainScrollY);
                }
                pendingStateSaveIdRef.current = null;
            }

            // Legacy scroll message support
            if (event.data?.type === 'scroll' && selectedReportId) {
                saveReportScrollPosition(selectedReportId, event.data.scrollY);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [selectedReportId, saveReportScrollPosition, saveReportIframeState, getReportIframeState]);

    // When switching reports, update iframe URL and prepare state restoration
    useEffect(() => {
        if (!selectedReport) return;

        const reportId = selectedReport.id;

        if (reportId !== previousReportIdRef.current || !iframeUrl) {
            let targetUrl = API.url(selectedReport.url);
            let restoreIframeState = null;
            let restoreScroll = null;

            const savedIframeState = getReportIframeState(reportId);
            if (savedIframeState && savedIframeState.currentPage) {
                restoreIframeState = savedIframeState;
                targetUrl = API.url(savedIframeState.currentPage);
            } else {
                const savedScroll = getReportScrollPosition(reportId);
                if (savedScroll > 0) {
                    restoreScroll = savedScroll;
                }
            }

            pendingIframeRestoreRef.current = restoreIframeState;
            pendingScrollRestoreRef.current = restoreScroll;
            previousReportIdRef.current = reportId;
            restorationInProgressRef.current = true;

            setIframeUrl(targetUrl);
        }
    }, [selectedReport, iframeUrl, getReportIframeState, getReportScrollPosition]);

    // Restore scroll/state when iframe loads
    const handleIframeLoad = useCallback(() => {
        if (!iframeRef.current) return;

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
                setTimeout(() => {
                    restorationInProgressRef.current = false;
                }, 300);
            }, 150);
            return;
        }

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

    // Save current iframe state before switching to a new report
    const handleViewReport = useCallback((report: Report) => {
        if (selectedReportId && iframeRef.current) {
            pendingStateSaveIdRef.current = selectedReportId;
            iframeRef.current.contentWindow?.postMessage(
                { type: 'getState' },
                API.base()
            );
        }
        setSelectedReportId(report.id);
    }, [selectedReportId, setSelectedReportId]);

    return {
        iframeRef,
        iframeUrl,
        handleIframeLoad,
        handleViewReport,
    };
}
