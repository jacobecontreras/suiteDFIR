import { useEffect, RefObject } from 'react';
import { FileText, X, Maximize2 } from 'lucide-react';
import { API } from '@/lib/api';
import type { Report } from '@/types/report';

export interface ReportsViewProps {
    selectedReport: Report | null;
    isFullscreen: boolean;
    onFullscreenToggle: () => void;
    iframeRef: RefObject<HTMLIFrameElement | null>;
}

export function ReportsView({
    selectedReport,
    isFullscreen,
    onFullscreenToggle,
    iframeRef
}: ReportsViewProps) {
    // Fullscreen Esc key listener
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isFullscreen) {
                onFullscreenToggle();
            }
        };

        if (isFullscreen) {
            document.addEventListener('keydown', handleEsc);
            return () => document.removeEventListener('keydown', handleEsc);
        }
    }, [isFullscreen, onFullscreenToggle]);

    return (
        <>
            {selectedReport ? (
                <>
                    {/* Fullscreen toggle button */}
                    <button
                        onClick={onFullscreenToggle}
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
    );
}
