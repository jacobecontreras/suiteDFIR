import { useEffect, useMemo, useCallback, ReactNode } from 'react'
import { createLeappApi } from '@/services/leappApi'
import { Card, CardContent } from "@/components/ui/Card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConfirmDialog, useHistoricalLogs } from "@/hooks"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { DeviceVisualization, BackupControls, BackupLogPanel, BackupLibraryPanel } from "@/components/backup"
import { useToast } from "@/hooks/use-toast"
import { useCase } from "@/context/CaseContext"
import { useBackup } from "@/context/BackupContext"
import { API } from "@/lib/api"
import { getUniqueName } from "@/lib/naming"

interface ExtractionPageProps {
    type: 'ios' | 'android';
    actionSlot?: ReactNode;
}

export default function ExtractionPage({ type, actionSlot }: ExtractionPageProps) {
    const {
        config,
        devices,
        backups,
        logs,
        progressLogs,
        isBackingUp,
        isLoadingDevices,
        activeBackupId,
        isAwaitingDevicePasscode,
        updateConfig,
        fetchDevices,
        fetchBackups,
        startBackup,
        stopBackup,
        clearLogs
    } = useBackup(type);

    const { backupName, selectedDevice, isEncrypted, backupPassword } = config;

    // Filter devices and backups by platform type
    const platformDevices = useMemo(() => {
        return devices.filter(d => d.type === type);
    }, [devices, type]);

    const platformBackups = useMemo(() => {
        return backups.filter(b => b.type === type);
    }, [backups, type]);

    // Derived value: only truthy if the selected device belongs to THIS platform.
    // This prevents cross-platform "connected" display when both pages share state.
    const platformSelectedDevice = useMemo(() => {
        if (!selectedDevice) return '';
        const match = platformDevices.find(d => d.udid === selectedDevice);
        return match ? selectedDevice : '';
    }, [selectedDevice, platformDevices]);
    const selectedPlatformDeviceInfo = useMemo(() => {
        if (!platformSelectedDevice) return undefined;
        return platformDevices.find(d => d.udid === platformSelectedDevice);
    }, [platformDevices, platformSelectedDevice]);
    const isDeviceEncrypted = selectedPlatformDeviceInfo?.is_encrypted ?? false;

    // Platform-specific auto-selection: auto-select the first device of this
    // platform type when devices change, and clear selection when none remain.
    useEffect(() => {
        if (platformDevices.length > 0 && !platformSelectedDevice) {
            // A device of this type exists but isn't selected — auto-select it
            updateConfig({ selectedDevice: platformDevices[0].udid });
        }
    }, [platformDevices, platformSelectedDevice, updateConfig]);
    const { toast } = useToast()
    const { selectedCaseId } = useCase()
    const { config: confirmConfig, show: showConfirm, hide: hideConfirm, handleConfirm } = useConfirmDialog();

    const { selectedId: selectedBackupId, historicalLogs, handleItemClick: handleBackupClick, clearSelection: clearSelectedBackup } = useHistoricalLogs(
        isBackingUp,
        useCallback((id: number) => API.path(`/backups/${id}/log`), []),
        platformBackups.map(b => b.id)
    );

    const isViewingActiveLog = isBackingUp && !selectedBackupId;
    const currentLogKey = selectedBackupId ? `backup-${selectedBackupId}` : 'active';
    const currentLogScrollPosition = config.logScrollPos[currentLogKey] ?? 0;
    const displayedLogs = selectedBackupId ? historicalLogs : logs;
    const derivedLiveProgressLogs = useMemo(() => {
        if (!isViewingActiveLog) return {};

        const combined: Record<string, string> = { ...progressLogs };
        const progressPattern = /^\[.*?\]\s+\d+(?:\.\d+)?%/;

        for (let i = logs.length - 1; i >= 0; i -= 1) {
            const line = logs[i]?.trim();
            if (!line || !progressPattern.test(line)) continue;

            if (!combined.overall && /Finished/i.test(line)) {
                combined.overall = line;
                continue;
            }

            if (!combined.file && !/Finished/i.test(line)) {
                combined.file = line;
            }

            if (combined.overall && combined.file) break;
        }

        return combined;
    }, [isViewingActiveLog, logs, progressLogs]);
    const activeProgressPercent = useMemo(() => {
        if (!derivedLiveProgressLogs['overall']) return 0;
        const match = derivedLiveProgressLogs['overall'].match(/(\d+(?:\.\d+)?)%/);
        return match ? Math.round(parseFloat(match[1])) : 0;
    }, [derivedLiveProgressLogs]);

    const handleLogScrollPositionChange = useCallback((position: number) => {
        updateConfig({
            logScrollPos: {
                ...config.logScrollPos,
                [currentLogKey]: position
            }
        });
    }, [config.logScrollPos, currentLogKey, updateConfig]);

    const handleOpenLogFile = async () => {
        if (!selectedBackupId) return;
        try {
            await fetch(API.path(`/backups/${selectedBackupId}/open-log`), { method: 'POST' });
        } catch (error) {
            console.error('Failed to open log file:', error);
        }
    };

    // Initial fetch on mount for this specific page
    useEffect(() => {
        fetchBackups(selectedCaseId || undefined);
    }, [selectedCaseId, fetchBackups]);


    const handleStartBackup = async () => {
        if (!platformSelectedDevice || !backupName) return

        const uniqueName = getUniqueName(backupName, platformBackups.map(b => b.name));

        try {
            await startBackup(platformSelectedDevice, uniqueName, selectedCaseId ? parseInt(selectedCaseId) : undefined)
            toast({
                title: "Backup Started",
                description: `Backup '${uniqueName}' has started in the background.`,
            })
            updateConfig({ backupName: '' })
        } catch (error) {
            console.error('Failed to start backup:', error)
            toast({
                title: "Error",
                description: "Failed to start backup process",
                variant: "destructive"
            })
        }
    }

    const handleStopBackup = async (backupId: number) => {
        try {
            await stopBackup(backupId)
            toast({
                title: "Backup Stopping",
                description: "Backup cancellation requested...",
            })
        } catch (error) {
            console.error('Failed to stop backup:', error)
            toast({
                title: "Error",
                description: "Failed to stop backup",
                variant: "destructive"
            })
        }
    }

    const handleOpenLocation = async (path: string) => {
        try {
            await fetch(API.path(`/backups/open?path=${encodeURIComponent(path)}`), {
                method: 'POST'
            });
        } catch (error) {
            console.error('Failed to open location:', error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to open backup location",
            })
        }
    };

    const handleExport = async (path: string) => {
        // Use the dedicated backup download endpoint
        window.location.href = API.path(`/ios/backup/download?path=${encodeURIComponent(path)}`);
    };

    const handleDeleteBackup = async (id: number) => {
        // Check if this is the last backup BEFORE deletion (more reliable than filtering)
        const isLastBackup = platformBackups.length === 1;

        try {
            const api = createLeappApi(type);
            await api.backup.deleteBackup(id)
            toast({
                title: "Backup Deleted",
                description: "Backup files have been removed.",
            })

            // Clear selection if the deleted backup was selected
            if (selectedBackupId === id) {
                clearSelectedBackup();
            }

            // Clear persisted logs if this was the last backup and no backup is active or starting
            // Guard against clearing during the backup-start window when isAwaitingDevicePasscode is true
            if (isLastBackup && !isBackingUp && !isAwaitingDevicePasscode && activeBackupId === null) {
                clearLogs();
            }

            fetchBackups(selectedCaseId || undefined)
        } catch (error) {
            console.error('Failed to delete backup:', error)
            toast({
                title: "Error",
                description: "Failed to delete backup",
                variant: "destructive"
            })
        }
    }

    // iOS encryption control
    const encryptionControl = type === 'ios' && platformSelectedDevice ? (
        <Tooltip>
            <TooltipTrigger asChild>
                <label className="flex items-center justify-center gap-1.5 cursor-pointer select-none text-center">
                    <div className="relative shrink-0">
                        <input
                            type="checkbox"
                            checked={isEncrypted || isDeviceEncrypted}
                            onChange={(e) => {
                                if (isDeviceEncrypted) return;
                                updateConfig({ isEncrypted: e.target.checked });
                            }}
                            disabled={isBackingUp || isDeviceEncrypted}
                            className="appearance-none w-3.5 h-3.5 rounded border border-white/50 bg-transparent focus:ring-0 focus:outline-none"
                            style={{
                                borderWidth: '1px',
                                backgroundColor: (isEncrypted || isDeviceEncrypted) ? '#262626' : 'transparent'
                            }}
                        />
                        {(isEncrypted || isDeviceEncrypted) && (
                            <svg className="absolute w-2.5 h-2.5 text-white pointer-events-none" style={{ top: '6px', left: '2px' }} viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                        )}
                    </div>
                    <span className="relative top-px text-[11px] font-medium tracking-wide text-gray-100">
                        Encrypt Backup
                    </span>
                </label>
            </TooltipTrigger>
            {isDeviceEncrypted && (
                <TooltipContent
                    side="top"
                    sideOffset={8}
                    className="max-w-[140px] rounded-md border border-white/5 bg-[#1f1f1f] px-2 py-1.5 text-[10px] leading-[1.4] text-gray-300 shadow-md text-center [&_[data-slot=tooltip-arrow]]:hidden"
                >
                    Already encrypted on device. Use the existing password for analysis.
                </TooltipContent>
            )}
        </Tooltip>
    ) : null;

    const encryptionPasswordInput = type === 'ios' && platformSelectedDevice && isEncrypted && !isDeviceEncrypted ? (
        <div className="mt-1.5 animate-in fade-in slide-in-from-top-2 duration-200">
            <input
                type="password"
                value={backupPassword}
                onChange={(e) => updateConfig({ backupPassword: e.target.value })}
                placeholder="Password"
                disabled={isBackingUp}
                className="w-32 bg-[#1A1A1A] border border-[#333] focus:border-blue-500/50 transition-colors h-6 px-2 rounded text-[10px] text-white"
            />
        </div>
    ) : null;

    // Combine encryption checkbox and password input for DeviceVisualization
    const deviceEncryptionControl = type === 'ios' && platformSelectedDevice ? (
        <>
            {encryptionControl}
            {encryptionPasswordInput}
        </>
    ) : null;

    return (
        <div className="h-full w-full flex flex-col bg-[#151515] text-white py-[3vh] px-[9vh] dark">
            <div className="flex-1 min-h-0 flex gap-[9vh]">
                {/* Left Section - Device Configuration */}
                <div className="flex-1 flex flex-col min-h-0">
                    <Card className="flex-1 h-full bg-transparent border-none shadow-none text-white flex flex-col relative overflow-visible group">
                        <CardContent className="flex flex-col h-full relative z-10 p-0">
                            {/* Device Visualization Section */}
                            <DeviceVisualization
                                type={type}
                                isConnected={!!platformSelectedDevice}
                                encryptionControl={deviceEncryptionControl}
                            />

                            {/* Form Controls */}
                            <BackupControls
                                backupName={backupName}
                                onBackupNameChange={(name) => updateConfig({ backupName: name })}
                                selectedDevice={platformSelectedDevice}
                                devices={platformDevices}
                                isLoadingDevices={isLoadingDevices}
                                onRefreshDevices={fetchDevices}
                                isBackingUp={isBackingUp}
                                onStartBackup={handleStartBackup}
                                actionSlot={actionSlot}
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* Right Section - Processing Log & Backup Library */}
                <div className="flex-1 basis-0 min-w-0 h-full flex flex-col min-h-0 gap-4">
                    {/* Processing Log - Top 2/3 */}
                    <BackupLogPanel
                        logs={displayedLogs}
                        progressLogs={derivedLiveProgressLogs}
                        isProcessing={isBackingUp}
                        isViewingActiveLog={isViewingActiveLog}
                        isAwaitingDevicePasscode={isAwaitingDevicePasscode}
                        activeBackupId={activeBackupId}
                        currentLogKey={currentLogKey}
                        currentLogScrollPosition={currentLogScrollPosition}
                        onScrollPositionChange={handleLogScrollPositionChange}
                        onClearLogs={clearLogs}
                        onOpenLogFile={handleOpenLogFile}
                        onStopBackup={isViewingActiveLog && activeBackupId ? () => handleStopBackup(activeBackupId) : undefined}
                        type={type}
                    />

                    {/* Backup Library - Bottom 1/3 */}
                    <BackupLibraryPanel
                        backups={platformBackups}
                        selectedBackupId={selectedBackupId}
                        isViewingActiveLog={isViewingActiveLog}
                        activeBackupId={activeBackupId}
                        activeProgressPercent={activeProgressPercent}
                        onBackupClick={handleBackupClick}
                        onClearSelection={clearSelectedBackup}
                        onOpenLocationClick={(backup) => showConfirm({
                            title: 'Open Location',
                            message: 'Open backup location in Finder?',
                            confirmLabel: 'Open',
                            onConfirm: () => handleOpenLocation(backup.path)
                        })}
                        onDeleteClick={(backup) => showConfirm({
                            title: 'Delete Backup',
                            message: 'Are you sure you want to delete this backup? This action cannot be undone.',
                            variant: 'destructive',
                            confirmLabel: 'Delete',
                            onConfirm: () => handleDeleteBackup(backup.id)
                        })}
                    />
                </div>
            </div>
            <ConfirmDialog
                config={confirmConfig}
                onClose={hideConfirm}
                onConfirm={handleConfirm}
            />
        </div>
    )
}
