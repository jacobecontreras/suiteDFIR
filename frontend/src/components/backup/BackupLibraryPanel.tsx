import { Smartphone, Trash2, FolderOpen } from 'lucide-react'
import { LibraryCard } from "@/components/ui/LibraryCard"
import { ItemLibrary } from "@/components/ui/ItemLibrary"
import { Backup } from "@/types/backup"

interface BackupLibraryPanelProps {
    backups: Backup[]
    selectedBackupId: number | null
    isViewingActiveLog: boolean
    activeBackupId: number | null
    activeProgressPercent: number
    onBackupClick: (id: number) => void
    onClearSelection: () => void
    onOpenLocationClick: (backup: Backup) => void
    onDeleteClick: (backup: Backup) => void
}

export function BackupLibraryPanel({
    backups,
    selectedBackupId,
    isViewingActiveLog,
    activeBackupId,
    activeProgressPercent,
    onBackupClick,
    onClearSelection,
    onOpenLocationClick,
    onDeleteClick
}: BackupLibraryPanelProps) {
    return (
        <ItemLibrary
            title="Backup Library"
            emptyMessage="No backups yet."
        >
            {backups.filter(b => b.status !== 'cancelled').map((backup) => {
                const displayProgress = backup.status === 'in_progress' && backup.id === activeBackupId && activeProgressPercent > 0
                    ? activeProgressPercent
                    : (backup.progress !== undefined ? Math.round(backup.progress) : 0);

                return (
                    <LibraryCard
                        key={backup.id}
                        title={backup.name}
                        isSelected={selectedBackupId === backup.id || (isViewingActiveLog && backup.id === activeBackupId)}
                        onClick={() => backup.id === activeBackupId ? onClearSelection() : onBackupClick(backup.id)}
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
                                (backup.status ?? '').toUpperCase().replace('_', ' '),
                            progress: displayProgress
                        } : undefined}
                        actions={[
                            {
                                icon: FolderOpen,
                                label: 'Open Location',
                                disabled: backup.status === 'in_progress',
                                onClick: () => onOpenLocationClick(backup)
                            },
                            {
                                icon: Trash2,
                                label: 'Delete Backup',
                                disabled: backup.status === 'in_progress',
                                variant: 'destructive',
                                onClick: () => onDeleteClick(backup)
                            }
                        ]}
                        className="w-full"
                    />
                );
            })}
        </ItemLibrary>
    )
}
