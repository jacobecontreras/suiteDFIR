import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Calendar, Trash2, Image, Eye } from 'lucide-react'

import { Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, ItemLibrary, LibraryCard, ConfirmDialog } from '@/components/ui'
import LogViewer from '@/components/leapp/LogViewer'
import FileSelector from '@/components/leapp/FileSelector'
import PhotogrepArtifactSelector, { ALL_ARTIFACT_KEYS } from './PhotogrepArtifactSelector'

import { useCase } from '@/context/CaseContext'
import { usePhotos } from '@/context/PhotosContext'
import { usePhotosExtraction } from '@/hooks/usePhotosExtraction'
import { useCasePersistedState } from '@/hooks/useCasePersistedState'
import { useConfirmDialog } from '@/hooks'
import { API } from '@/lib/api'
import { createLeappApi } from '@/lib/leappApi'
import { generateProgressBar } from '@/lib/progress'
import type { Backup } from '@/types/backup'
import type { PhotoExtraction } from '@/types/photos'

const leappApi = createLeappApi('ileapp')

interface PhotogrepPageProps {
    toolSelector?: ReactNode
}

export default function PhotogrepPage({ toolSelector }: PhotogrepPageProps) {
    const { selectedCaseId } = useCase()
    const navigate = useNavigate()
    const { extractions, loadExtractions, deleteExtraction, selectExtraction } = usePhotos()
    const extraction = usePhotosExtraction()
    const { config: confirmConfig, show: showConfirm, hide: hideConfirm, handleConfirm } = useConfirmDialog()

    // Persisted config
    const [extractionName, setExtractionName] = useCasePersistedState<string>('photogrep_name', '')
    const [inputFile, setInputFile] = useCasePersistedState<string>('photogrep_input', '')
    const [selectedArtifacts, setSelectedArtifacts] = useCasePersistedState<string[]>('photogrep_artifacts', ALL_ARTIFACT_KEYS)

    // Local state
    const [selectedBackup, setSelectedBackup] = useState<Backup | null>(null)
    const [isValidating, setIsValidating] = useState(false)
    const [showPasswordDialog, setShowPasswordDialog] = useState(false)
    const [password, setPassword] = useState('')
    const [isPasswordError, setIsPasswordError] = useState(false)

    // Completed extractions for library
    const completedExtractions = extractions.filter(e => e.status === 'completed' && e.image_count > 0)

    // Refresh extractions when processing completes
    useEffect(() => {
        if (!extraction.isExtracting && extraction.extractionId) {
            const timer = setTimeout(() => loadExtractions(), 1000)
            return () => clearTimeout(timer)
        }
    }, [extraction.isExtracting, extraction.extractionId, loadExtractions])

    // Artifact selection handlers
    const handleToggle = useCallback((key: string, selected: boolean) => {
        setSelectedArtifacts(prev =>
            selected ? [...prev, key] : prev.filter(k => k !== key)
        )
    }, [setSelectedArtifacts])

    const handleSelectAll = useCallback(() => {
        setSelectedArtifacts(ALL_ARTIFACT_KEYS)
    }, [setSelectedArtifacts])

    const handleSelectNone = useCallback(() => {
        setSelectedArtifacts([])
    }, [setSelectedArtifacts])

    // Start extraction
    const handleStart = async () => {
        if (!selectedBackup || !inputFile) return

        setIsValidating(true)
        try {
            const validation = await leappApi.processing.validateBackup(inputFile)

            if (!validation.valid) {
                extraction.clearLogs()
                return
            }

            if (validation.encrypted) {
                setShowPasswordDialog(true)
                return
            }

            await doExtract()
        } catch (e) {
            console.error('Validation failed:', e)
        } finally {
            setIsValidating(false)
        }
    }

    const doExtract = async (pw?: string) => {
        if (!selectedBackup || !selectedCaseId) return
        await extraction.startExtraction(
            selectedBackup.id,
            Number(selectedCaseId),
            pw,
            extractionName || undefined,
            selectedArtifacts.length > 0 ? selectedArtifacts : undefined,
        )
    }

    const handlePasswordSubmit = async () => {
        setShowPasswordDialog(false)
        setIsValidating(false)
        await doExtract(password)
        setPassword('')
    }

    // Library actions
    const handleViewExtraction = (ext: PhotoExtraction) => {
        selectExtraction(ext)
        navigate('/photos')
    }

    const handleDeleteExtraction = (id: number) => {
        showConfirm({
            title: 'Delete Extraction',
            message: 'Are you sure you want to delete this extraction and all its files?',
            variant: 'destructive',
            confirmLabel: 'Delete',
            onConfirm: async () => {
                await deleteExtraction(id)
            },
        })
    }

    const canStart = !extraction.isExtracting && !!selectedBackup && selectedArtifacts.length > 0

    const processingPercent = extraction.progress && extraction.progress.total > 0
        ? Math.round((extraction.progress.current / extraction.progress.total) * 100)
        : 0

    return (
        <div className="h-full w-full flex flex-col bg-[#151515] text-white py-[3vh] px-[9vh]">
            {/* Main Content */}
            <div className="flex-1 flex gap-[9vh] min-h-0">
                {/* Left Panel - Input & Controls */}
                <div className="flex-1 basis-0 min-w-0 h-full flex flex-col gap-6 min-h-0">
                    {/* Tool Selector */}
                    {toolSelector}

                    {/* Input & Name Row */}
                    <div className="flex gap-6">
                        <div className="flex-1 space-y-2 min-w-0">
                            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Name</label>
                            <Input
                                type="text"
                                value={extractionName}
                                onChange={(e) => setExtractionName(e.target.value)}
                                disabled={extraction.isExtracting}
                                placeholder="Enter extraction name..."
                                className="w-full h-8 text-xs"
                            />
                        </div>

                        <FileSelector
                            label="Input"
                            value={inputFile}
                            onChange={(val) => setInputFile(val)}
                            onBackupSelect={(backup) => setSelectedBackup(backup)}
                            disabled={extraction.isExtracting}
                            placeholder="Select iOS backup..."
                            showFolderOption={true}
                            tool="ileapp"
                            caseId={selectedCaseId ? parseInt(selectedCaseId) : undefined}
                        />
                    </div>

                    {/* Artifact Selection */}
                    <PhotogrepArtifactSelector
                        selectedArtifacts={selectedArtifacts}
                        onToggle={handleToggle}
                        onSelectAll={handleSelectAll}
                        onSelectNone={handleSelectNone}
                        isProcessing={extraction.isExtracting}
                    />

                    {/* Start Button */}
                    <div className="w-full">
                        <Button
                            onClick={handleStart}
                            disabled={!canStart || isValidating}
                            className="w-full h-9"
                        >
                            {isValidating
                                ? 'Checking Backup...'
                                : extraction.isExtracting
                                    ? 'Extracting...'
                                    : 'Start Extraction'}
                        </Button>
                    </div>
                </div>

                {/* Right Panel - Logs & Extraction Library */}
                <div className="flex-1 basis-0 min-w-0 h-full flex flex-col min-h-0 gap-4">
                    {/* Processing Log */}
                    <div className="flex-[2] bg-[#171717] border border-[#333333] rounded-lg overflow-hidden flex flex-col min-h-0">
                        <div className="px-4 py-2 border-b border-[#333333] bg-[#1A1A1A] flex justify-between items-center">
                            <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">Extraction Log</h3>
                            <Button
                                onClick={() => extraction.clearLogs()}
                                variant="secondary"
                                className="px-3 py-1 h-auto text-xs"
                            >
                                Clear
                            </Button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <LogViewer
                                logs={extraction.logs}
                                enabled={true}
                                isProcessing={extraction.isExtracting}
                                progressCurrent={extraction.progress?.current ?? 0}
                                progressLogs={
                                    extraction.isExtracting && extraction.progress
                                        ? { overall: `${generateProgressBar(processingPercent)} ${extraction.progress.current}/${extraction.progress.total}` }
                                        : undefined
                                }
                                emptyMessage="No extraction activity yet."
                            />
                        </div>
                    </div>

                    {/* Extraction Library */}
                    <ItemLibrary
                        title="Extraction Library"
                        emptyMessage="No photo extractions yet."
                        phantomCard={
                            extraction.isExtracting ? (
                                <LibraryCard
                                    title={extractionName || 'Extraction'}
                                    isSelected={true}
                                    onClick={() => {}}
                                    subtitle={
                                        <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                                            <span className="flex items-center gap-0.5">
                                                <Calendar size={9} />
                                                {new Date().toLocaleDateString()}
                                            </span>
                                            <span>&bull;</span>
                                            <span>{extraction.progress?.phase || 'Starting...'}</span>
                                        </div>
                                    }
                                    status={{
                                        state: 'processing',
                                        label: `Extracting... ${processingPercent}%`,
                                        progress: processingPercent,
                                    }}
                                    actions={[
                                        { icon: Eye, label: 'View', onClick: () => {}, disabled: true },
                                        { icon: Trash2, label: 'Delete', onClick: () => {}, disabled: true },
                                    ]}
                                    className="w-full border-white/20 shadow-xl"
                                />
                            ) : undefined
                        }
                    >
                        {completedExtractions.map((ext) => (
                            <LibraryCard
                                key={ext.id}
                                title={ext.device_name}
                                isSelected={false}
                                onClick={() => handleViewExtraction(ext)}
                                subtitle={
                                    <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                                        <span className="flex items-center gap-0.5">
                                            <Image size={9} />
                                            {ext.image_count} photos
                                        </span>
                                        <span>&bull;</span>
                                        <span className="flex items-center gap-0.5">
                                            <Calendar size={9} />
                                            {new Date(ext.created_at).toLocaleDateString()}
                                        </span>
                                        {ext.indexed && (
                                            <>
                                                <span>&bull;</span>
                                                <span className="text-gray-300">searchable</span>
                                            </>
                                        )}
                                    </div>
                                }
                                actions={[
                                    {
                                        icon: Eye,
                                        label: 'View Gallery',
                                        onClick: () => handleViewExtraction(ext),
                                    },
                                    {
                                        icon: Trash2,
                                        label: 'Delete',
                                        variant: 'destructive',
                                        onClick: () => handleDeleteExtraction(ext.id),
                                    },
                                ]}
                                className="w-full"
                            />
                        ))}
                    </ItemLibrary>
                </div>
            </div>

            {/* Password Dialog */}
            <Dialog open={showPasswordDialog} onOpenChange={(open: boolean) => setShowPasswordDialog(open)}>
                <DialogContent className="max-w-[340px] p-5 bg-[#1A1A1A] border-[#333333] rounded-xl shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-semibold text-white tracking-wide uppercase">Encrypted Backup Detected</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-3">
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                            This iTunes backup is encrypted. Please enter the password to decrypt and extract photos.
                        </p>
                        {isPasswordError && (
                            <p className="text-[11px] text-red-500 font-medium animate-in fade-in slide-in-from-top-1">
                                Wrong password
                            </p>
                        )}
                        <div className="relative">
                            <Lock className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-500" />
                            <Input
                                type="password"
                                placeholder="Backup Password"
                                className={`pl-8 h-8 text-xs bg-[#222] border-white/10 focus:border-white/20 ${isPasswordError ? 'border-red-500/50 focus:border-red-500' : ''}`}
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value)
                                    if (isPasswordError) setIsPasswordError(false)
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handlePasswordSubmit()
                                }}
                            />
                        </div>
                    </div>
                    <DialogFooter className="flex gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 h-8 text-[11px] bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                            onClick={() => setShowPasswordDialog(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handlePasswordSubmit}
                            disabled={!password}
                            size="sm"
                            className="flex-1 h-8 text-[11px] bg-white/10 hover:bg-white/20 text-white border border-white/10"
                        >
                            Unlock &amp; Extract
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog config={confirmConfig} onClose={hideConfirm} onConfirm={handleConfirm} />
        </div>
    )
}
