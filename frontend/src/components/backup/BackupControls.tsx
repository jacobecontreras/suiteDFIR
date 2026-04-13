import { ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Device } from "@/types/backup"

interface BackupControlsProps {
    backupName: string
    onBackupNameChange: (name: string) => void
    selectedDevice: string
    devices: Device[]
    isLoadingDevices: boolean
    onRefreshDevices: () => void
    isBackingUp: boolean
    onStartBackup: () => void
    actionSlot?: ReactNode
    encryptionControl?: ReactNode
}

export function BackupControls({
    backupName,
    onBackupNameChange,
    selectedDevice,
    devices,
    isLoadingDevices,
    onRefreshDevices,
    isBackingUp,
    onStartBackup,
    actionSlot,
    encryptionControl
}: BackupControlsProps) {
    const selectedDeviceInfo = devices.find(d => d.udid === selectedDevice)

    return (
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
                        onChange={(e) => onBackupNameChange(e.target.value)}
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
                                    {selectedDevice ? (
                                        <>
                                            {selectedDeviceInfo?.name || "Unknown Device"}
                                            {selectedDeviceInfo?.is_rooted && (
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
                            onClick={onRefreshDevices}
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 border-[#333] bg-[#262626] hover:bg-[#333] hover:text-white shrink-0"
                        >
                            <RefreshCw className={`h-4 w-4 ${isLoadingDevices ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Encryption control section (iOS checkbox) */}
            {encryptionControl}

            {/* Action Button */}
            <div className="pt-3">
                <Button
                    className="w-full h-9 bg-white text-black hover:bg-gray-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={onStartBackup}
                    disabled={!selectedDevice || !backupName || isBackingUp}
                >
                    {isBackingUp ? "Backing Up..." : "Start Backup"}
                </Button>
            </div>
        </div>
    )
}
