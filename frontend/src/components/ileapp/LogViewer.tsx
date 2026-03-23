import { useEffect, useMemo, useRef } from 'react';
import { useAutoScroll } from '../../hooks/useAutoScroll';
import { Loader2, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface LogViewerProps {
  logs: string[];
  progressLogs?: Record<string, string>;
  enabled?: boolean;
  isProcessing?: boolean;
  progressCurrent?: number;
  spinnerLabel?: string;
  hideLogLines?: boolean;
  scrollKey?: string;
  scrollPosition?: number;
  onScrollPositionChange?: (position: number) => void;
  onStop?: () => void;
  canStop?: boolean;
  emptyMessage?: string;
}

export default function LogViewer({ 
  logs, 
  progressLogs = {}, 
  enabled = true, 
  isProcessing = false, 
  progressCurrent = -1,
  spinnerLabel = "Processing...",
  hideLogLines = false,
  scrollKey = 'active',
  scrollPosition = 0,
  onScrollPositionChange,
  onStop,
  canStop = false,
  emptyMessage = "No activity yet."
}: LogViewerProps) {
  const displayedLogs = useMemo(() => (
    hideLogLines
      ? []
      :
    logs.filter(log => {
      if (/^Processing started\. Please wait\. This may take a few minutes\.\.\./i.test(log.trim())) {
        return false;
      }

      return /\b(start(?:ed|ing)?|completed)\b/i.test(log);
    })
  ), [hideLogLines, logs]);
  const { logsRef, handleScroll, setShouldAutoScroll } = useAutoScroll(displayedLogs, enabled);
  const isSyncingScroll = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousScrollKeyRef = useRef(scrollKey);

  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    // Only restore when switching between items, not on every log update
    if (previousScrollKeyRef.current === scrollKey) return;

    const container = logsRef.current;
    if (!container) return;

    if (isProcessing && scrollKey === 'active') {
      isSyncingScroll.current = true;
      setShouldAutoScroll(true);

      const timer = setTimeout(() => {
        container.scrollTop = container.scrollHeight;
        isSyncingScroll.current = false;
        previousScrollKeyRef.current = scrollKey;
      }, 0);

      return () => clearTimeout(timer);
    }

    // Skip restoration during active processing for non-active historical views.
    if (isProcessing) {
      previousScrollKeyRef.current = scrollKey;
      return;
    }

    const currentScroll = container.scrollTop;
    const threshold = 5; // Increased from 1px for high DPI
    if (Math.abs(currentScroll - scrollPosition) <= threshold) {
      previousScrollKeyRef.current = scrollKey;
      return;
    }

    isSyncingScroll.current = true;
    container.scrollTop = scrollPosition;

    const maxScrollTop = Math.max(container.scrollHeight - container.clientHeight, 0);
    const isNearBottom = Math.abs(maxScrollTop - scrollPosition) <= 50;
    setShouldAutoScroll(isNearBottom);

    const timer = setTimeout(() => {
      isSyncingScroll.current = false;
      previousScrollKeyRef.current = scrollKey;
    }, 50);

    return () => clearTimeout(timer);
  }, [scrollKey, scrollPosition, isProcessing, setShouldAutoScroll]);

  const handleViewerScroll = (event: React.UIEvent<HTMLDivElement>) => {
    handleScroll();

    if (isSyncingScroll.current || !onScrollPositionChange) return;

    const nextPosition = event.currentTarget.scrollTop;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    scrollTimeoutRef.current = setTimeout(() => {
      onScrollPositionChange(nextPosition);
      scrollTimeoutRef.current = null;
    }, 150);
  };

  // Render log lines with uniform color (no highlighting)
  const formatLogLine = (log: string, index: number) => {
    return (
      <div key={index} className="whitespace-pre-wrap break-all text-gray-400">
        {log}
      </div>
    );
  };

  const hasDisplayableContent = displayedLogs.length > 0 || Object.keys(progressLogs).length > 0;
  const shouldShowCenteredProcessingState = isProcessing && displayedLogs.length === 0;
  
  // Priority 1: If there is content to show (logs or bottom progress updates), show the log area.
  if (hasDisplayableContent) {
    return (
      <div className="h-full flex flex-col bg-[#171717] overflow-hidden relative">
        {shouldShowCenteredProcessingState ? (
          <div className="flex-1 flex flex-col items-center justify-center px-4 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/20 mb-4" />
            <p className="text-[11px] font-semibold text-white tracking-[0.3em] uppercase opacity-90">{spinnerLabel}</p>
          </div>
        ) : (
          <div
            ref={logsRef}
            onScroll={handleViewerScroll}
            className="flex-1 overflow-y-auto font-mono text-[10px] leading-tight p-4 custom-scrollbar"
          >
            <div className="flex flex-col gap-0.5">
              {displayedLogs.map((log, index) => formatLogLine(log, index))}
            </div>
          </div>
        )}

        {Object.keys(progressLogs).length > 0 && (
          <div className="flex-none bg-transparent px-4 py-2 border-t border-[#333] flex items-center gap-3 font-mono text-[10px] leading-tight relative z-10 min-h-[36px]">
            <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
              {Object.entries(progressLogs).map(([type, log]) => (
                <div key={`progress-${type}`} className="overflow-hidden text-ellipsis whitespace-pre text-gray-200 font-semibold tracking-wide">
                  {log}
                </div>
              ))}
            </div>
            {onStop && (
              <Button
                variant="ghost"
                size="icon"
                disabled={!canStop}
                onClick={onStop}
                title="Stop"
                className="h-7 w-7 shrink-0 self-center text-white hover:bg-white/10 disabled:opacity-40"
              >
                <StopCircle size={15} className="shrink-0" />
              </Button>
            )}
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
    <div className="h-full flex items-center justify-center bg-[#171717] px-4">
      <p className="text-[11px] text-gray-500 uppercase tracking-wider text-center">{emptyMessage}</p>
    </div>
  );
}
