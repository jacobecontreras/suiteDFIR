import { useEffect, useMemo, useState, useCallback, ReactNode } from 'react'
import { createLeappApi } from '@/services/leappApi'
import { RefreshCw, Smartphone, Trash2, ChevronDown, FolderOpen, Download, FileText, HardDrive } from 'lucide-react'
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Dropdown } from "@/components/ui"
import { LibraryCard } from "@/components/ui/LibraryCard"
import { ItemLibrary } from "@/components/ui/ItemLibrary"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConfirmDialog, useHistoricalLogs } from "@/hooks"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import Iphone15Pro from "@/components/ui/shadcn-io/iphone-15-pro"
import AndroidPhone from "@/components/ui/shadcn-io/android-phone"
import LogViewer from "@/components/ileapp/LogViewer"
import { useToast } from "@/hooks/use-toast"
import { useCase } from "@/context/CaseContext"
import { useBackup } from "@/context/BackupContext"
import { Device, Backup } from "@/types/backup"
import { cn } from "@/lib/utils"
import { API } from "@/lib/api"
import { getUniqueName } from "@/lib/naming"
import { generateProgressBar } from "@/utils/progress"

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

    return (
        <div className="h-full w-full flex flex-col bg-[#151515] text-white py-[3vh] px-[9vh] dark">
            <div className="flex-1 min-h-0 flex gap-[9vh]">
                {/* Left Section - Device Configuration */}
                <div className="flex-1 flex flex-col min-h-0">
                    <Card className="flex-1 h-full bg-transparent border-none shadow-none text-white flex flex-col relative overflow-visible group">
                        <CardContent className="flex flex-col h-full relative z-10 p-0">
                            {/* Device Visualization Section - Grows to fill space */}
                            <div className="flex-1 flex flex-col items-center justify-center relative min-h-0">
                                {/* Glow effect behind device (always visible but subtle) */}
                                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full blur-3xl transition-all duration-700 ${platformSelectedDevice ? 'bg-blue-500/10 opacity-50' : 'bg-gray-500/5 opacity-30'}`} />

                                <div className="relative translate-y-8 transform transition-transform duration-700 hover:translate-y-8 hover:scale-[1.02]">
                                    {type === 'ios' ? (
                                        <Iphone15Pro className="h-[378px] w-auto drop-shadow-2xl">
                                            {!platformSelectedDevice && (
                                                <div className="h-full w-full flex flex-col items-center justify-center bg-[#050505] text-gray-500 space-y-4">
                                                    <p className="text-2xl font-light tracking-wide text-gray-400">Not Connected</p>
                                                </div>
                                            )}
                                            {platformSelectedDevice && (
                                                <div className="h-full w-full bg-black flex flex-col px-8 py-8">
                                                    <div className="flex-1 flex items-center justify-center">
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src="/apple-logo.svg"
                                                            alt="Connected"
                                                            className="w-28 h-28 opacity-80"
                                                            style={{ filter: 'invert(1)' }}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </Iphone15Pro>
                                    ) : (
                                        <AndroidPhone className="h-[378px] w-auto drop-shadow-2xl">
                                            {!platformSelectedDevice && (
                                                <div className="h-full w-full flex flex-col items-center justify-center bg-[#050505] text-gray-500 space-y-4">
                                                    <p className="text-2xl font-light tracking-wide text-gray-400">Not Connected</p>
                                                </div>
                                            )}
                                            {platformSelectedDevice && (
                                                <div className="h-full w-full bg-black flex items-center justify-center">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img
                                                        src="/android-logo.svg"
                                                        alt="Connected"
                                                        className="w-24 h-24 opacity-80"
                                                        style={{ filter: 'invert(1)' }}
                                                    />
                                                </div>
                                            )}
                                        </AndroidPhone>
                                    )}
                                </div>

                                {/* iOS Encrypt Backup - positioned below phone */}
                                {type === 'ios' && platformSelectedDevice && (
                                    <div className="absolute top-[calc(50%+230px)] left-1/2 -translate-x-1/2 text-white">
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

                                        {isEncrypted && !isDeviceEncrypted && (
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
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Form Controls - Anchored at bottom */}
                            <div className="mt-auto min-h-[264px] pt-6 flex flex-col justify-end gap-3">
                                {actionSlot ? (
                                    <div className="w-full h-9">
                                        {actionSlot}
                                    </div>
                                ) : null}

                                {/* Name and Target Device Row */}
                                <div className="flex gap-3">
                                    {/* Name Input - Left side */}
                                    <div className="flex-1 space-y-3">
                                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">
                                            Name
                                        </label>
                                        <Input
                                            type="text"
                                            value={backupName}
                                            onChange={(e) => updateConfig({ backupName: e.target.value })}
                                            placeholder="Enter backup name..."
                                            disabled={isBackingUp}
                                            className="w-full"
                                        />
                                    </div>

                                    {/* Target Device - Right side */}
                                    <div className="flex-1 space-y-3">
                                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">
                                            Target Device
                                        </label>
                                        <div className="flex gap-2 w-full">
                                            <div className="flex-1 relative">
                                                <div className="w-full bg-[#262626] border border-[#333] text-white h-9 flex items-center px-3 rounded-md text-sm">
                                                    <span className="truncate flex items-center gap-2">
                                                        {platformSelectedDevice ? (
                                                            <>
                                                                {platformDevices.find(d => d.udid === platformSelectedDevice)?.name || "Unknown Device"}
                                                                {platformDevices.find(d => d.udid === platformSelectedDevice)?.is_rooted && (
                                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 uppercase">
                                                                        Rooted
                                                                    </span>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <span className="text-gray-500 font-normal">No device connected</span>
                                                        )}
                                                    </span>
                                                </div>
                                            </div>
                                            <Button
                                                onClick={fetchDevices}
                                                variant="outline"
                                                size="icon"
                                                className="h-9 w-9 border-[#333] bg-[#262626] hover:bg-[#333] hover:text-white shrink-0"
                                            >
                                                <RefreshCw className={`h-4 w-4 ${isLoadingDevices ? 'animate-spin' : ''}`} />
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Button */}
                                <div className="pt-3">
                                    <Button
                                        className="w-full h-9 bg-white text-black hover:bg-gray-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={handleStartBackup}
                                        disabled={!platformSelectedDevice || !backupName || isBackingUp}
                                    >
                                        {isBackingUp ? "Backing Up..." : "Start Backup"}
                                    </Button>
                                </div>
                            </div>





                        </CardContent>
                    </Card>
                </div>

                {/* Right Section - Processing Log & Backup Library */}
                <div className="flex-1 basis-0 min-w-0 h-full flex flex-col min-h-0 gap-4">
                    {/* Processing Log - Top 2/3 */}
                    <div className="flex-[2] min-h-0 bg-[#171717] border border-[#333333] rounded-lg overflow-hidden flex flex-col">
                        <div className="px-4 py-2 border-b border-[#333333] bg-[#1A1A1A] flex justify-between items-center">
                            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Processing Log</h3>
                            <div className="flex items-center gap-2">
                                <Button
                                    onClick={handleOpenLogFile}
                                    variant="secondary"
                                    className="px-2 py-1 h-auto text-xs"
                                    disabled={!selectedBackupId}
                                    title="Open log location"
                                >
                                    <FileText size={13} />
                                </Button>
                                <Button
                                    onClick={clearLogs}
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
                                hideLogLines
                                progressLogs={
                                    isViewingActiveLog
                                      ? (() => {
                                          const result: Record<string, string> = {};
                                          Object.entries(derivedLiveProgressLogs).forEach(([pType, log]) => {
                                              // ADB output looks like: "[  3%] /sdcard/... "
                                              // Sometimes it looks like: "[#       ] 3% /sdcard/... " or similar
                                              const match = log.match(/(\d+(?:\.\d+)?)%/);
                                              if (match && match[1]) {
                                                  const percent = parseFloat(match[1]);
                                                  
                                                  // Strip out existing brackets/percentages to extract just the filepath or remaining text
                                                  let description = log.replace(/\[.*?\]/g, '').replace(/\d+(?:\.\d+)?%/, '').trim();
                                                  // Clean up trailing/leading brackets or slashes if leftover
                                                  description = description.replace(/^\]\s*/, '').trim();

                                                  if (type === 'android') {
                                                      // For Android (ADB), the file progress line contains the overall percentage and the file path.
                                                      if (pType === 'file') {
                                                          // Make the overall progress bar slightly shorter so it fits nicely
                                                          result['overall'] = `${generateProgressBar(percent, 20)} Overall Progress`;
                                                          // Remove the visual bar for the current file since ADB only provides the overall sync percentage
                                                          result['file'] = `Current File: ${description}`;
                                                      } else {
                                                          result[pType] = `${generateProgressBar(percent, 20)} ${description}`;
                                                      }
                                                  } else {
                                                      // iOS (libimobiledevice)
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
                                          // Ensure 'overall' appears before 'file' when rendered
                                          const sortedResult: Record<string, string> = {};
                                          if (result['overall']) sortedResult['overall'] = result['overall'];
                                          Object.keys(result).forEach(k => {
                                              if (k !== 'overall') sortedResult[k] = result[k];
                                          });
                                          return sortedResult;
                                      })()
                                      : {}
                                } 
                                isProcessing={isBackingUp}
                                progressCurrent={(() => {
                                    if (isBackingUp) {
                                        if (derivedLiveProgressLogs && derivedLiveProgressLogs['overall']) {
                                            const match = derivedLiveProgressLogs['overall'].match(/(\d+(?:\.\d+)?)%/);
                                            return match ? Math.round(parseFloat(match[1])) : 0;
                                        }
                                    }
                                    return 0;
                                })()}
                                spinnerLabel={
                                    type === 'ios' && isViewingActiveLog && isAwaitingDevicePasscode
                                        ? "Enter Passcode on Device..."
                                        : "Backing up..."
                                }
                                scrollKey={currentLogKey}
                                scrollPosition={currentLogScrollPosition}
                                onScrollPositionChange={handleLogScrollPositionChange}
                                onStop={isViewingActiveLog && activeBackupId ? () => handleStopBackup(activeBackupId) : undefined}
                                canStop={isBackingUp}
                            />
                        </div>
                    </div>

                    {/* Backup Library - Bottom 1/3 */}
                    <ItemLibrary
                        title="Backup Library"
                        emptyMessage="No backups yet."
                    >
                        {platformBackups.filter(b => b.status !== 'cancelled').map((backup) => (
                            (() => {
                                const displayProgress = backup.status === 'in_progress' && backup.id === activeBackupId && activeProgressPercent > 0
                                    ? activeProgressPercent
                                    : (backup.progress !== undefined ? Math.round(backup.progress) : 0);

                                return (
                            <LibraryCard
                                key={backup.id}
                                title={backup.name}
                                isSelected={selectedBackupId === backup.id || (isViewingActiveLog && backup.id === activeBackupId)}
                                onClick={() => backup.id === activeBackupId && isBackingUp ? clearSelectedBackup() : handleBackupClick(backup.id)}
                                subtitle={
                                    <span className="flex items-center gap-0.5">
                                        <Smartphone size={9} />
                                        {backup.device_name}
                                    </span>
                                }
                                status={backup.status !== 'completed' ? {
                                    state: backup.status === 'in_progress' ? 'processing' :
                                        backup.status === 'failed' ? 'error' : 'default',
                                    label: backup.status === 'in_progress'
                                        ? `Processing... ${displayProgress}%`
                                        :
                                        backup.status.toUpperCase().replace('_', ' '),
                                    progress: displayProgress
                                } : undefined}
                                actions={[
                                    {
                                        icon: FolderOpen,
                                        label: 'Open Location',
                                        disabled: backup.status === 'in_progress',
                                        onClick: () => {
                                            showConfirm({
                                                title: 'Open Location',
                                                message: 'Open backup location in Finder?',
                                                confirmLabel: 'Open',
                                                onConfirm: () => handleOpenLocation(backup.path)
                                            });
                                        }
                                    },
                                    {
                                        icon: Trash2,
                                        label: 'Delete Backup',
                                        disabled: backup.status === 'in_progress',
                                        variant: 'destructive',
                                        onClick: () => {
                                            showConfirm({
                                                title: 'Delete Backup',
                                                message: 'Are you sure you want to delete this backup? This action cannot be undone.',
                                                variant: 'destructive',
                                                confirmLabel: 'Delete',
                                                onConfirm: () => handleDeleteBackup(backup.id)
                                            });
                                        }
                                    }
                                ]}
                                className="w-full"
                            />
                                );
                            })()
                        ))}
                    </ItemLibrary>
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
