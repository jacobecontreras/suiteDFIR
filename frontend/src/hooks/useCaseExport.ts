import { useState, useRef } from 'react';
import { API } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import type { ExportStatus } from '@/components/library';

export function useCaseExport(selectedCaseId: string | null) {
    const { toast } = useToast();
    const [exportStatus, setExportStatus] = useState<ExportStatus>({ status: 'idle' });
    const [showExportDialog, setShowExportDialog] = useState(false);
    const eventSourceRef = useRef<EventSource | null>(null);
    const exportCompletedRef = useRef(false);

    const handleExportClick = (reportsCount: number, backupsCount: number) => {
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

        exportCompletedRef.current = false;
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
                            exportCompletedRef.current = true;
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
                if (!exportCompletedRef.current) {
                    setExportStatus({
                        status: 'error',
                        message: 'Connection lost. Please check if export completed.'
                    });
                }
            };

        } catch (error) {
            console.error('Export error:', error);
            const message = error instanceof Error ? error.message : 'Failed to start export';
            setExportStatus({ status: 'error', message });
            toast({
                title: "Export Failed",
                description: message,
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
        exportCompletedRef.current = false;
        setExportStatus({ status: 'idle' });
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
    };

    return {
        exportStatus,
        showExportDialog,
        setShowExportDialog,
        handleExportClick,
        startExport,
        downloadExport,
        resetExport,
    };
}
