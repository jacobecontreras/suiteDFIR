
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import LogViewer from './LogViewer';
import FileSelector from './FileSelector';
import ModuleSelector from './ModuleSelector';
import ProcessControls from './ProcessControls';
import { useLeapp } from '@/context/LeappContext';

import { Button, Input, ConfirmDialog, LibraryCard, ItemLibrary } from '@/components/ui';
import { useCase } from '@/context/CaseContext';
import { FolderOpen, Calendar, Trash2, Download, FileText } from 'lucide-react';
import { useConfirmDialog, useHistoricalLogs } from '@/hooks';

import { API } from '@/lib/api';
import { generateProgressBar } from '@/lib/progress';
import type { Report } from '@/types/report';

interface LeappPageProps {
    tool: 'ileapp' | 'aleapp';
    toolName: string;
    toolSelector?: ReactNode;
}

function LeappContent({ tool, toolSelector }: { tool: 'ileapp' | 'aleapp'; toolSelector?: ReactNode }) {
    const outputFolder = '';
    const { states, updateConfig, clearLogs, clearProcessingReportName, fetchModules, stopProcessing } = useLeapp();
    const toolState = states[tool];
    const { config, processing } = toolState;
    const { inputFile, reportName } = config;
    const { logs, isProcessing, processingReportName, progress } = processing;

    const [reports, setReports] = useState<Report[]>([]);
    const { selectedCaseId } = useCase();
    const { config: confirmConfig, show: showConfirm, hide: hideConfirm, handleConfirm } = useConfirmDialog();
    const { selectedId: selectedReportId, historicalLogs, handleItemClick: handleReportClick, clearSelection: clearSelectedReport } = useHistoricalLogs(
        isProcessing,
        useCallback((id: number) => API.path(`/reports/${id}/view/processing.log`), []),
        reports.map(r => r.id)
    );

    const isViewingActiveLog = isProcessing && !selectedReportId;
    const currentLogKey = selectedReportId ? `report-${selectedReportId}` : 'active';
    const currentLogScrollPosition = config.logScrollPos[currentLogKey] ?? 0;
    const displayedLogs = selectedReportId ? historicalLogs : logs;
    const processingPercent = progress && progress.total > 0
        ? Math.round((progress.current / progress.total) * 100)
        : 0;

    const handleLogScrollPositionChange = useCallback((position: number) => {
        updateConfig(tool, {
            logScrollPos: {
                ...config.logScrollPos,
                [currentLogKey]: position
            }
        });
    }, [config.logScrollPos, currentLogKey, tool, updateConfig]);

    const handleOpenLogFile = async () => {
        if (!selectedReportId) return;
        try {
            await fetch(API.path(`/reports/${selectedReportId}/open-log`), { method: 'POST' });
        } catch (error) {
            console.error('Failed to open log file:', error);
        }
    };

    // Fetch reports for the current tool
    const fetchReports = useCallback(async () => {
        try {
            const url = selectedCaseId
                ? API.path(`/reports?case_id=${selectedCaseId}`)
                : API.path('/reports');
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                // Filter to only show reports for the current tool
                setReports(data.filter((r: Report) => r.tool === tool));
            }
        } catch (error) {
            console.error('Failed to fetch reports:', error);
        }
    }, [selectedCaseId, tool]);

    // Fetch reports on mount and when case changes
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        fetchReports();
    }, [fetchReports]);

    // Refresh reports when processing completes
    useEffect(() => {
        if (!isProcessing && logs.length > 0) {
            // Small delay to ensure backend has updated
            const timer = setTimeout(fetchReports, 1000);
            return () => clearTimeout(timer);
        }
    }, [isProcessing, logs.length, fetchReports]);

    useEffect(() => {
        if (processingReportName && reports.some(r => r.name === processingReportName)) {
            clearProcessingReportName(tool);
        }
    }, [reports, processingReportName, clearProcessingReportName, tool]);

    // Fetch modules once on mount or when tool/case changes
    useEffect(() => {
        const currentToolState = states[tool];
        // Only fetch if not currently processing AND not already loaded
        if (currentToolState.modules.length === 0 && !currentToolState.isLoadingModules) {
            fetchModules(tool);
        }
    }, [tool, fetchModules, states]);



    const handleOpenLocation = (id: number) => {
        showConfirm({
            title: 'Open Location',
            message: 'Open report location in Finder?',
            confirmLabel: 'Open',
            onConfirm: async () => {
                try {
                    await fetch(API.path(`/reports/${id}/open`), {
                        method: 'POST'
                    });
                } catch (error) {
                    console.error('Failed to open location:', error);
                }
            }
        });
    };

    const handleDeleteReport = (id: number) => {
        showConfirm({
            title: 'Delete Report',
            message: 'Are you sure you want to delete this report? This action cannot be undone.',
            variant: 'destructive',
            confirmLabel: 'Delete',
            onConfirm: async () => {
                // Check if this is the last report BEFORE deletion (more reliable than filtering)
                const isLastReport = reports.length === 1;

                try {
                    const response = await fetch(API.path(`/reports/${id}`), {
                        method: 'DELETE'
                    });
                    if (response.ok) {
                        // Clear selection if the deleted report was selected
                        if (selectedReportId === id) {
                            clearSelectedReport();
                        }

                        // Clear persisted logs if this was the last report and no processing is active
                        if (isLastReport && !isProcessing) {
                            clearLogs(tool);
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
        <div className="h-full w-full flex flex-col bg-[#151515] text-white py-[3vh] px-[9vh]">
            {/* Logo */}


            {/* Main Content */}
            <div className="flex-1 flex gap-[9vh] min-h-0">
                {/* Left Panel - Input & Controls */}
                <div className="flex-1 basis-0 min-w-0 h-full flex flex-col gap-6 min-h-0">
                    {/* Tool Selector */}
                    {toolSelector}

                    {/* Input & Report Name Row */}
                    <div className="flex gap-6">
                        {/* Report Name Section */}
                        <div className="flex-1 space-y-2 min-w-0">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Name</label>
                            <Input
                                type="text"
                                value={reportName}
                                onChange={(e) => updateConfig(tool, { reportName: e.target.value })}
                                disabled={isProcessing}
                                placeholder="Enter report name..."
                                className="w-full h-8 text-xs"
                            />
                        </div>

                        <FileSelector
                            label="Input"
                            value={inputFile}
                            onChange={(val) => updateConfig(tool, { inputFile: val })}
                            disabled={isProcessing}
                            placeholder="Select input..."
                            showFolderOption={true}
                            tool={tool}
                            caseId={selectedCaseId ? parseInt(selectedCaseId) : undefined}
                        />
                    </div>

                    {/* Module Selection */}
                    <ModuleSelector
                        tool={tool}
                        isProcessing={isProcessing}
                    />

                    {/* Process Controls */}
                    <ProcessControls
                        tool={tool}
                        inputFile={inputFile}
                        outputFolder={outputFolder}
                        reportName={reportName}
                        caseId={selectedCaseId ? parseInt(selectedCaseId) : undefined}
                        existingNames={[...reports.map(r => r.name), ...(processingReportName ? [processingReportName] : [])]}
                    />
                </div>

                {/* Right Panel - Logs & Report Library */}
                <div className="flex-1 basis-0 min-w-0 h-full flex flex-col min-h-0 gap-4">
                    {/* Processing Log - Top 2/3 */}
                    <div className="flex-[2] bg-[#171717] border border-[#333333] rounded-lg overflow-hidden flex flex-col min-h-0">
                        <div className="px-4 py-2 border-b border-[#333333] bg-[#1A1A1A] flex justify-between items-center">
                            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Processing Log</h3>
                            <div className="flex items-center gap-2">
                                <Button
                                    onClick={handleOpenLogFile}
                                    variant="secondary"
                                    className="px-2 py-1 h-auto text-xs"
                                    disabled={!selectedReportId}
                                    title="Open log location"
                                >
                                    <FileText size={13} />
                                </Button>
                                <Button
                                    onClick={() => clearLogs(tool)}
                                    variant="secondary"
                                    className="px-3 py-1 h-auto text-xs"
                                >
                                    Clear
                                </Button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <LogViewer
                                logs={displayedLogs}
                                enabled={true}
                                isProcessing={isProcessing}
                                progressCurrent={progress?.current ?? 0}
                                progressLogs={isViewingActiveLog && progress ? { overall: `${generateProgressBar(Math.round((progress.current / (progress.total || 1)) * 100))} ${progress.current}/${progress.total}` } : undefined}
                                scrollKey={currentLogKey}
                                scrollPosition={currentLogScrollPosition}
                                onScrollPositionChange={handleLogScrollPositionChange}
                                onStop={isViewingActiveLog ? () => stopProcessing(tool) : undefined}
                                canStop={isProcessing}
                            />
                        </div>
                    </div>

                    <ItemLibrary
                        title="Report Library"
                        emptyMessage="No reports yet."
                        phantomCard={
                            processingReportName && !reports.some(r => r.name === processingReportName) ? (
                                <LibraryCard
                                    title={processingReportName}
                                    isSelected={isViewingActiveLog}
                                    onClick={clearSelectedReport}
                                    subtitle={
                                        <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                                            <span className="flex items-center gap-0.5">
                                                <Calendar size={9} />
                                                {new Date().toLocaleDateString()}
                                            </span>
                                            {!isProcessing && (
                                                <>
                                                    <span>&bull;</span>
                                                    <span className="animate-pulse">Finalizing...</span>
                                                </>
                                            )}
                                        </div>
                                    }
                                    status={{
                                        state: 'processing',
                                        label: isProcessing ? `Processing... ${processingPercent}%` : 'Completing',
                                        progress: isProcessing ? processingPercent : 100
                                    }}
                                    actions={[
                                        { icon: FolderOpen, label: 'Open', onClick: () => { }, disabled: true },
                                        { icon: Download, label: 'Download', onClick: () => { }, disabled: true },
                                        { icon: Trash2, label: 'Delete', onClick: () => { }, disabled: true }
                                    ]}
                                    className="w-full border-white/20 shadow-xl"
                                />
                            ) : undefined
                        }
                    >
                        {reports.map((report) => (
                            <LibraryCard
                                key={report.id}
                                title={report.name}
                                isSelected={selectedReportId === report.id}
                                onClick={() => handleReportClick(report.id)}
                                subtitle={
                                    <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                                        <span className="flex items-center gap-0.5">
                                            <Calendar size={9} />
                                            {new Date(report.created_at).toLocaleDateString()}
                                        </span>
                                        <span>&bull;</span>
                                        <span>{report.size}</span>
                                    </div>
                                }
                                actions={[
                                    {
                                        icon: FolderOpen,
                                        label: 'Open Location',
                                        onClick: () => handleOpenLocation(report.id)
                                    },
                                    {
                                        icon: Trash2,
                                        label: 'Delete Report',
                                        variant: 'destructive',
                                        onClick: () => handleDeleteReport(report.id)
                                    }
                                ]}
                                className="w-full"
                            />
                        ))}
                    </ItemLibrary>
                </div>
            </div>
            {/* Confirmation Dialog */}
            <ConfirmDialog
                config={confirmConfig}
                onClose={hideConfirm}
                onConfirm={handleConfirm}
            />
        </div>
    );
}

export default function LeappPage({ tool, toolSelector }: LeappPageProps) {
    return <LeappContent tool={tool} toolSelector={toolSelector} />;
}
