import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';

export interface ViewMode {
    value: 'reports' | 'backups';
}

export interface LibraryHeaderProps {
    exportStatus: {
        status: 'idle' | 'creating' | 'processing' | 'completed' | 'error';
        progress?: number;
    };
    onExportClick: () => void;
    viewMode: 'reports' | 'backups';
    onViewModeChange: (mode: 'reports' | 'backups') => void;
}

export function LibraryHeader({
    exportStatus,
    onExportClick,
    viewMode,
    onViewModeChange
}: LibraryHeaderProps) {
    return (
        <div className="h-[64px] flex items-center justify-between gap-6 flex-shrink-0">
            {/* Left: Export button */}
            <Button
                onClick={exportStatus.status === 'idle' ? onExportClick : undefined}
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
                    onClick={() => onViewModeChange('reports')}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        viewMode === 'reports'
                            ? 'bg-white/10 text-white'
                            : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                >
                    Reports
                </button>
                <button
                    onClick={() => onViewModeChange('backups')}
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
    );
}
