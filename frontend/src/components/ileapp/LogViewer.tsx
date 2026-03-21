import { useAutoScroll } from '../../hooks/useAutoScroll';
import { Loader2 } from 'lucide-react';

interface LogViewerProps {
  logs: string[];
  progressLogs?: Record<string, string>;
  enabled?: boolean;
  isProcessing?: boolean;
  progressCurrent?: number;
  spinnerLabel?: string;
}

export default function LogViewer({ 
  logs, 
  progressLogs = {}, 
  enabled = true, 
  isProcessing = false, 
  progressCurrent = -1,
  spinnerLabel = "Processing..."
}: LogViewerProps) {
  const { logsRef, handleScroll } = useAutoScroll(logs, enabled);

  // Render log lines with uniform color (no highlighting)
  const formatLogLine = (log: string, index: number) => {
    return (
      <div key={index} className="whitespace-pre-wrap break-all text-gray-400">
        {log}
      </div>
    );
  };

  const hasDisplayableContent = logs.length > 0 || Object.keys(progressLogs).length > 0;
  
  // Priority 1: If there is content to show (logs or bottom progress updates), show the log area.
  if (hasDisplayableContent) {
    const showBanner = isProcessing && progressCurrent === 0;
    return (
      <div className="h-full flex flex-col bg-[#171717] overflow-hidden relative">
        {showBanner && (
          <div className="flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] border-b border-[#333] shadow-sm z-20 shrink-0">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
            <span className="text-[11px] font-medium text-white tracking-widest uppercase">{spinnerLabel}</span>
          </div>
        )}
        <div
          ref={logsRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto font-mono text-[10px] leading-tight p-4 custom-scrollbar"
        >
          <div className="flex flex-col gap-0.5">
            {logs.map((log, index) => formatLogLine(log, index))}
          </div>
        </div>

        {Object.keys(progressLogs).length > 0 && (
          <div className="flex-none bg-transparent px-4 pt-3 pb-4 border-t border-[#333] flex flex-col gap-1 font-mono text-[10px] leading-tight relative z-10">
            {Object.entries(progressLogs).map(([type, log]) => (
              <div key={`progress-${type}`} className="overflow-hidden text-ellipsis whitespace-pre text-gray-200 font-semibold tracking-wide">
                {log}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Priority 2: If we are actively processing and at 0 progress, show the large centered "Initializing" spinner.
  if (isProcessing && (progressCurrent === 0 || progressCurrent === -1)) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#171717] select-none animate-in fade-in duration-500">
        <Loader2 className="h-6 w-6 animate-spin text-white/20 mb-4" />
        <p className="text-[11px] font-semibold text-white tracking-[0.3em] uppercase opacity-90">{spinnerLabel}</p>
      </div>
    );
  }

  // Priority 3: If we are processing but logs are still empty (e.g. filtered out), 
  // show the log area with the banner but no centered placeholder.
  if (isProcessing) {
    return (
      <div className="h-full flex flex-col bg-[#171717] overflow-hidden relative animate-in fade-in duration-300">
        <div className="flex items-center gap-3 px-4 py-3 bg-[#1A1A1A] border-b border-[#333] shadow-sm z-20 shrink-0">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
          <span className="text-[11px] font-medium text-white tracking-widest uppercase">{spinnerLabel}</span>
        </div>
        <div className="flex-1" />
      </div>
    );
  }

  // Priority 4: Finally, if idle and empty, show an empty container.
  return (
    <div className="h-full bg-[#171717]" />
  );
}