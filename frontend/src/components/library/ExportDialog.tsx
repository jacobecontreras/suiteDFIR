import { Download, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';

export interface ExportStatus {
    status: 'idle' | 'creating' | 'processing' | 'completed' | 'error';
    jobId?: number;
    progress?: number;
    downloadUrl?: string;
    message?: string;
}

export interface ExportDialogProps {
    showConfirm: boolean;
    exportStatus: Omit<ExportStatus, 'status'> & { status: 'idle' | 'creating' | 'processing' | 'completed' | 'error' };
    reportsCount: number;
    backupsCount: number;
    onConfirm: () => void;
    onClose: () => void;
    onDownload: () => void;
    onReset: () => void;
}

export function ExportDialog({
    showConfirm,
    exportStatus,
    reportsCount,
    backupsCount,
    onConfirm,
    onClose,
    onDownload,
    onReset
}: ExportDialogProps) {
    // Export confirmation dialog
    if (showConfirm) {
        return (
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
                            onClick={onClose}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="default"
                            size="sm"
                            className="flex-1 h-8 text-xs bg-blue-500 hover:bg-blue-600 text-white"
                            onClick={onConfirm}
                        >
                            Start Export
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // Export progress dialog
    if (exportStatus.status !== 'idle') {
        return (
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
                            {exportStatus.status === 'creating' && 'Starting Export'}
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
                                    onClick={onReset}
                                >
                                    Close
                                </Button>
                            )}
                            {exportStatus.status === 'completed' && (
                                <Button
                                    variant="default"
                                    size="sm"
                                    className="flex-1 h-8 text-xs bg-blue-500 hover:bg-blue-600 text-white"
                                    onClick={onDownload}
                                >
                                    Download
                                </Button>
                            )}
                            {(exportStatus.status === 'creating' || exportStatus.status === 'processing') && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="w-full h-8 text-xs bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                                    onClick={onReset}
                                >
                                    Cancel
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}
