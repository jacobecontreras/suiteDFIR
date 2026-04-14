import { FileText } from 'lucide-react'
import { Button } from "@/components/ui/Button"
import LogViewer from "@/components/leapp/LogViewer"
import { generateProgressBar } from "@/lib/progress"

interface BackupLogPanelProps {
    logs: string[]
    progressLogs: Record<string, string>
    isProcessing: boolean
    isViewingActiveLog: boolean
    isAwaitingDevicePasscode: boolean
    activeBackupId: number | null
    currentLogKey: string
    currentLogScrollPosition: number
    onScrollPositionChange: (position: number) => void
    onClearLogs: () => void
    onOpenLogFile: () => void
    onStopBackup?: () => void
    type: 'ios' | 'android'
}

export function BackupLogPanel({
    logs,
    progressLogs,
    isProcessing,
    isViewingActiveLog,
    isAwaitingDevicePasscode,
    activeBackupId,
    currentLogKey,
    currentLogScrollPosition,
    onScrollPositionChange,
    onClearLogs,
    onOpenLogFile,
    onStopBackup,
    type,
}: BackupLogPanelProps) {
    const progressCurrent = (() => {
        if (isProcessing) {
            if (progressLogs && progressLogs['overall']) {
                const match = progressLogs['overall'].match(/(\d+(?:\.\d+)?)%/);
                return match ? Math.round(parseFloat(match[1])) : 0;
            }
        }
        return 0;
    })()

    const enhancedProgressLogs = isViewingActiveLog
        ? (() => {
            const result: Record<string, string> = {};
            Object.entries(progressLogs).forEach(([pType, log]) => {
                const match = log.match(/(\d+(?:\.\d+)?)%/);
                if (match && match[1]) {
                    const percent = parseFloat(match[1]);

                    let description = log.replace(/\[.*?\]/g, '').replace(/\d+(?:\.\d+)?%/, '').trim();
                    description = description.replace(/^\]\s*/, '').trim();

                    if (type === 'android') {
                        if (pType === 'file') {
                            result['overall'] = `${generateProgressBar(percent, 20)} Overall Progress`;
                            result['file'] = `Current File: ${description}`;
                        } else {
                            result[pType] = `${generateProgressBar(percent, 20)} ${description}`;
                        }
                    } else {
                        if (pType === 'overall') {
                            result['overall'] = `${generateProgressBar(percent, 20)} Overall Progress`;
                        } else {
                            result[pType] = `${generateProgressBar(percent, 20)} Current File ${description}`;
                        }
                    }
                } else {
                    result[pType] = log;
                }
            });
            const sortedResult: Record<string, string> = {};
            if (result['overall']) sortedResult['overall'] = result['overall'];
            Object.keys(result).forEach(k => {
                if (k !== 'overall') sortedResult[k] = result[k];
            });
            return sortedResult;
        })()
        : {}

    return (
        <div className="flex-[2] min-h-0 bg-[#171717] border border-[#333333] rounded-lg overflow-hidden flex flex-col">
            <div className="px-4 py-2 border-b border-[#333333] bg-[#1A1A1A] flex justify-between items-center">
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Processing Log</h3>
                <div className="flex items-center gap-2">
                    <Button
                        onClick={onOpenLogFile}
                        variant="secondary"
                        className="px-2 py-1 h-auto text-xs"
                        disabled={!activeBackupId}
                        title="Open log location"
                    >
                        <FileText size={13} />
                    </Button>
                    <Button
                        onClick={onClearLogs}
                        variant="secondary"
                        className="px-3 py-1 h-auto text-xs"
                    >
                        Clear
                    </Button>
                </div>
            </div>
            <div className="flex-1 overflow-hidden">
                <LogViewer
                    logs={logs}
                    hideLogLines
                    progressLogs={enhancedProgressLogs}
                    isProcessing={isProcessing}
                    progressCurrent={progressCurrent}
                    spinnerLabel={
                        type === 'ios' && isViewingActiveLog && isAwaitingDevicePasscode
                            ? "Enter Passcode on Device..."
                            : "Backing up..."
                    }
                    scrollKey={currentLogKey}
                    scrollPosition={currentLogScrollPosition}
                    onScrollPositionChange={onScrollPositionChange}
                    onStop={onStopBackup}
                    canStop={isProcessing}
                />
            </div>
        </div>
    )
}
