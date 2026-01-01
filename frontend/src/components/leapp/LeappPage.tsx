'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useProcessing, ProcessingProvider } from '../../hooks/useProcessing';
import { ModulesProvider } from '../../hooks/useModules';
import FileSelector from '../../components/ileapp/FileSelector';
import ModuleSelector from '../../components/ileapp/ModuleSelector';
import ProcessControls from '../../components/ileapp/ProcessControls';
import LogViewer from '../../components/ileapp/LogViewer';
import ToolNotInstalled from '../../components/ui/ToolNotInstalled';

import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui';
import { useCase } from '@/context/CaseContext';
import { FileText, FolderOpen, Calendar, Trash2, Loader2, Download } from 'lucide-react';

import { getToolsStatus } from '@/lib/api/tools';
import { cn } from '../../lib/utils';

interface LeappPageProps {
    tool: 'ileapp' | 'aleapp';
    logoPath: string;
    toolName: string;
}

interface Report {
    name: string;
    path: string;
    url: string;
    tool: 'ileapp' | 'aleapp';
    created_at: string;
    size: string;
}

function LeappContent({ logoPath, tool }: { logoPath: string; tool: string }) {
    const outputFolder = '';
    const router = useRouter();

    const [inputFile, setInputFile] = useState('');
    const [reportName, setReportName] = useState('');
    const [reports, setReports] = useState<Report[]>([]);
    const { logs, isProcessing, clearLogs, processingReportName, clearProcessingReportName } = useProcessing();
    const { selectedCaseId } = useCase();
    const [confirmConfig, setConfirmConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void | Promise<void>;
        variant?: 'destructive' | 'default';
        confirmLabel?: string;
    }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });

    // Timezone state
    const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const timezones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [
        "UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
        "Europe/London", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"
    ];

    // aLEAPP logo is 10% smaller than iLEAPP
    const logoHeight = tool === 'aleapp' ? 'h-[57.6px]' : 'h-16';

    // Fetch reports for the current tool
    const fetchReports = useCallback(async () => {
        try {
            const url = selectedCaseId
                ? `http://localhost:8000/api/reports?case_id=${selectedCaseId}`
                : 'http://localhost:8000/api/reports';
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

    // Clear processingReportName once the real report appears
    useEffect(() => {
        if (processingReportName && reports.some(r => r.name === processingReportName)) {
            clearProcessingReportName();
        }
    }, [reports, processingReportName, clearProcessingReportName]);

    const handleViewReport = () => {
        setConfirmConfig({
            isOpen: true,
            title: 'View Report',
            message: 'Navigate to Reports page to view this report?',
            confirmLabel: 'Navigate',
            onConfirm: () => {
                router.push('/reports');
                setConfirmConfig(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleOpenLocation = (path: string) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Open Location',
            message: 'Open report location in Finder?',
            confirmLabel: 'Open',
            onConfirm: async () => {
                try {
                    await fetch(`http://localhost:8000/api/reports/open?path=${encodeURIComponent(path)}`, {
                        method: 'POST'
                    });
                } catch (error) {
                    console.error('Failed to open location:', error);
                }
                setConfirmConfig(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    const handleDeleteReport = (path: string) => {
        setConfirmConfig({
            isOpen: true,
            title: 'Delete Report',
            message: 'Are you sure you want to delete this report? This action cannot be undone.',
            variant: 'destructive',
            confirmLabel: 'Delete',
            onConfirm: async () => {
                try {
                    const response = await fetch(`http://localhost:8000/api/reports?path=${encodeURIComponent(path)}`, {
                        method: 'DELETE'
                    });
                    if (response.ok) {
                        fetchReports();
                    }
                } catch (error) {
                    console.error('Failed to delete report:', error);
                }
                setConfirmConfig(prev => ({ ...prev, isOpen: false }));
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
                    {/* Logo */}
                    {/* 
                    <div className="flex items-center h-16">
                        <img src={logoPath} alt="Tool Logo" className={logoHeight} />
                    </div>
                    */}
                    {/* Input & Report Name Row */}
                    <div className="flex gap-6">
                        {/* Report Name Section */}
                        <div className="flex-1 space-y-2 min-w-0">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Name</label>
                            <Input
                                type="text"
                                value={reportName}
                                onChange={(e) => setReportName(e.target.value)}
                                disabled={isProcessing}
                                placeholder="Enter report name..."
                                className="w-full h-8 text-xs"
                            />
                        </div>

                        {/* Timezone Selection */}
                        <div className="w-1/3 space-y-2 min-w-0">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Timezone</label>
                            <Select value={timezone} onValueChange={setTimezone} disabled={isProcessing}>
                                <SelectTrigger className="w-full h-8 text-xs bg-[#1A1A1A] border-white/10">
                                    <SelectValue placeholder="Select timezone" />
                                </SelectTrigger>
                                <SelectContent>
                                    {timezones.map((tz) => (
                                        <SelectItem key={tz} value={tz} className="text-xs">
                                            {tz}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <FileSelector
                            label="Input"
                            value={inputFile}
                            onChange={setInputFile}
                            disabled={isProcessing}
                            placeholder="Select input..."
                            showFolderOption={true}
                            tool={tool}
                            caseId={selectedCaseId ? parseInt(selectedCaseId) : undefined}
                        />
                    </div>

                    {/* Module Selection */}
                    <ModuleSelector
                        isProcessing={isProcessing}
                    />

                    {/* Process Controls */}
                    <ProcessControls
                        inputFile={inputFile}
                        outputFolder={outputFolder}
                        reportName={reportName}
                        caseId={selectedCaseId ? parseInt(selectedCaseId) : undefined}
                        timezone={timezone}
                    />
                </div>

                {/* Right Panel - Logs & Report Library */}
                <div className="flex-1 basis-0 min-w-0 h-full flex flex-col min-h-0 gap-4">
                    {/* Processing Log - Top 2/3 */}
                    <div className="flex-[2] bg-[#171717] border border-[#333333] rounded-lg overflow-hidden flex flex-col min-h-0">
                        <div className="px-4 py-2 border-b border-[#333333] bg-[#1A1A1A] flex justify-between items-center">
                            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Processing Log</h3>
                            <Button
                                onClick={clearLogs}
                                variant="secondary"
                                className="px-3 py-1 h-auto text-xs"
                            >
                                Clear Logs
                            </Button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <LogViewer logs={logs} enabled={true} />
                        </div>
                    </div>

                    {/* Report Library - Bottom 1/3 */}
                    <div className="flex-1 flex flex-col min-h-0 bg-[#171717] border border-[#333333] rounded-lg overflow-hidden">
                        <div className="px-4 py-2 border-b border-[#333333] bg-[#1A1A1A]">
                            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Report Library</h3>
                        </div>
                        <div className="flex-1 flex flex-col p-0 min-h-0 overflow-hidden">
                            {reports.length === 0 && !isProcessing && !processingReportName ? (
                                <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                    <p className="text-sm font-medium">No reports found</p>
                                    <p className="text-xs text-gray-600 mt-1">Generated reports will appear here</p>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                                    {/* Processing Report Entry - show while processing OR while waiting for report to appear */}
                                    {processingReportName && (
                                        <div
                                            className="group flex-shrink-0 w-full rounded-lg p-2 flex items-center gap-2 border transition-colors bg-[#1A1A1A] border-white/20"
                                        >
                                            {/* Info */}
                                            <div className="flex-1 min-w-0 flex flex-col justify-center items-start">
                                                <h3 className="text-white font-medium truncate text-xs text-left">{processingReportName}</h3>
                                                <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                                                    <span className="flex items-center gap-0.5">
                                                        <Calendar size={9} />
                                                        {new Date().toLocaleDateString()}
                                                    </span>
                                                    {!isProcessing && (
                                                        <>
                                                            <span>•</span>
                                                            <span>Saving report...</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Badge - Centered on Right */}
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className="processing-badge shrink-0 text-[10px] font-medium px-1.5 py-0 rounded border border-white/50 flex items-center gap-1"
                                                    style={{ backgroundColor: '#262626', color: 'white' }}
                                                >
                                                    <Loader2 size={8} className="animate-spin" />
                                                    {isProcessing ? 'Processing' : 'Completing'}
                                                </span>

                                                {/* Action Buttons (Disabled during processing) */}
                                                <div className="flex items-center gap-0.5 opacity-50 pointer-events-none">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        disabled
                                                        className="h-7 w-7 text-white"
                                                    >
                                                        <FolderOpen size={12} />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        disabled
                                                        className="h-7 w-7 text-white"
                                                    >
                                                        <Download size={12} />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        disabled
                                                        className="h-7 w-7 text-white"
                                                    >
                                                        <Trash2 size={12} />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {/* Existing Reports */}
                                    {reports.map((report) => (
                                        <div
                                            key={report.path}
                                            className="group flex-shrink-0 w-full rounded-lg p-2 flex items-center gap-2 border transition-colors bg-[#1A1A1A] border-white/10 hover:border-white/20"
                                        >
                                            {/* Info */}
                                            <div className="flex-1 min-w-0 flex flex-col justify-center items-start">
                                                <h3 className="text-white font-medium truncate text-xs text-left">{report.name}</h3>
                                                <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                                                    <span className="flex items-center gap-0.5">
                                                        <Calendar size={9} />
                                                        {new Date(report.created_at).toLocaleDateString()}
                                                    </span>
                                                    <span>•</span>
                                                    <span>{report.size}</span>
                                                </div>
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="flex items-center gap-0.5">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleOpenLocation(report.path)}
                                                    title="Open Location"
                                                    className="h-7 w-7 hover:bg-white/20 text-white"
                                                >
                                                    <FolderOpen size={12} />
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDeleteReport(report.path)}
                                                    title="Delete Report"
                                                    className="h-7 w-7 hover:bg-red-900/30 text-white hover:text-red-400"
                                                >
                                                    <Trash2 size={12} />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            {/* Confirmation Dialog */}
            <Dialog open={confirmConfig.isOpen} onOpenChange={(open) => !open && setConfirmConfig(prev => ({ ...prev, isOpen: false }))}>
                <DialogContent className="max-w-[340px] p-5 bg-[#1A1A1A] border-[#333333]">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-semibold text-white tracking-wide uppercase">{confirmConfig.title}</DialogTitle>
                    </DialogHeader>
                    <div className="py-2">
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                            {confirmConfig.message}
                        </p>
                    </div>
                    <DialogFooter className="mt-2 flex gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 h-8 text-[11px]"
                            onClick={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant={confirmConfig.variant === 'destructive' ? 'destructive' : 'default'}
                            size="sm"
                            className={cn(
                                "flex-1 h-8 text-[11px]",
                                confirmConfig.variant === 'destructive'
                                    ? "bg-red-900/20 hover:bg-red-900/40 text-white border border-red-900/30"
                                    : "bg-[#333333] hover:bg-[#404040] text-white border border-white/10"
                            )}
                            onClick={confirmConfig.onConfirm}
                        >
                            {confirmConfig.confirmLabel || 'Confirm'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function LeappPageWithCheck({ tool, logoPath }: LeappPageProps) {
    const [toolInstalled, setToolInstalled] = useState<boolean | null>(null);

    useEffect(() => {

        const checkTool = async () => {
            try {
                const status = await getToolsStatus();
                const toolStatus = status[tool];
                setToolInstalled(toolStatus?.installed ?? false);
            } catch (error) {
                console.error('Failed to check tool status:', error);
                // Assume installed on error to avoid blocking
                setToolInstalled(true);
            }
        };

        checkTool();
    }, [tool]);

    // Loading state
    if (toolInstalled === null) {
        return (
            <div className="h-full w-full flex items-center justify-center bg-[#151515] text-white">
                <div className="text-sm text-gray-500">Loading...</div>
            </div>
        );
    }

    // Tool not installed - show blocking screen
    if (!toolInstalled) {
        return <ToolNotInstalled tool={tool} />;
    }

    // Tool installed - show normal content
    return (
        <ProcessingProvider tool={tool}>
            <ModulesProvider tool={tool}>
                <LeappContent logoPath={logoPath} tool={tool} />
            </ModulesProvider>
        </ProcessingProvider>
    );
}

export default function LeappPage({ tool, logoPath, toolName }: LeappPageProps) {
    return <LeappPageWithCheck tool={tool} logoPath={logoPath} toolName={toolName} />;
}

