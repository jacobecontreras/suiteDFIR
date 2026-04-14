import React, { useState, useRef, useEffect, useCallback } from "react"
import { Folder, Check, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/utils"
import { API } from "@/lib/api"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { useConfirmDialog } from "@/hooks"
import { useSpatial } from "@/context/SpatialContext"
import { useClickOutside } from "@/hooks/useClickOutside"
import type { GeoJsonObject } from 'geojson'

export interface KmlFile {
    name: string
    url: string
    path: string
    is_deletable?: boolean
    is_temporary?: boolean
    data?: GeoJsonObject
}

interface KmlBrowserProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    temporaryKmls: KmlFile[]
    onTemporaryKmlsChange: React.Dispatch<React.SetStateAction<KmlFile[]>>
    onAddKmlData: (url: string, data: GeoJsonObject) => void
    onRemoveKmlData: (url: string) => void
    selectedCaseId: string | null
    refreshKey?: number
}

export default function KmlBrowser({
    isOpen,
    onOpenChange,
    temporaryKmls,
    onTemporaryKmlsChange,
    onAddKmlData,
    onRemoveKmlData,
    selectedCaseId,
    refreshKey,
}: KmlBrowserProps) {
    const { selectedKmlsPaths, setSelectedKmlsPaths } = useSpatial()
    const { config: confirmConfig, show: showConfirm, hide: hideConfirm, handleConfirm } = useConfirmDialog()
    const [kmlFiles, setKmlFiles] = useState<Record<string, KmlFile[]>>({})
    const kmlMenuRef = useRef<HTMLDivElement>(null)

    const suppressClickWhen = useCallback(() => confirmConfig.isOpen, [confirmConfig.isOpen])

    useClickOutside(
        [kmlMenuRef],
        () => onOpenChange(false),
        { enabled: isOpen, suppressClickWhen }
    )

    const fetchKmlFiles = React.useCallback(async () => {
        try {
            const baseUrl = selectedCaseId
                ? API.path(`/spatial/kml-files?case_id=${selectedCaseId}`)
                : API.path('/spatial/kml-files');
            const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}t=${new Date().getTime()}`;
            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setKmlFiles(data.files)
                return data.files;
            }
        } catch (error) {
            console.error("Failed to fetch KML files:", error)
        }
        return null;
    }, [selectedCaseId])

    useEffect(() => {
        if (isOpen) {
            fetchKmlFiles()
        }
    }, [isOpen, selectedCaseId, fetchKmlFiles, refreshKey])

    const toggleKmlSelection = (file: KmlFile) => {
        const isSelected = selectedKmlsPaths.includes(file.url)

        if (isSelected) {
            setSelectedKmlsPaths(selectedKmlsPaths.filter(p => p !== file.url))
        } else {
            setSelectedKmlsPaths([...selectedKmlsPaths, file.url])
            if (file.is_temporary && file.data) {
                onAddKmlData(file.url, file.data)
            }
        }
    }

    const handleDeleteKml = (e: React.MouseEvent, file: KmlFile) => {
        e.stopPropagation()

        const executeDelete = async () => {
            if (file.is_temporary) {
                onTemporaryKmlsChange(prev => prev.filter(f => f.url !== file.url))
                if (selectedKmlsPaths.includes(file.url)) {
                    setSelectedKmlsPaths(selectedKmlsPaths.filter(p => p !== file.url))
                }
                onRemoveKmlData(file.url)
                return
            }

            try {
                const res = await fetch(API.path(`/spatial/import/${encodeURIComponent(file.name)}`), {
                    method: 'DELETE'
                })

                if (res.ok) {
                    if (selectedKmlsPaths.includes(file.url)) {
                        setSelectedKmlsPaths(selectedKmlsPaths.filter(p => p !== file.url))
                    }
                    fetchKmlFiles()
                }
            } catch (error) {
                console.error("Failed to delete KML:", error)
            }
        }

        showConfirm({
            title: file.is_temporary ? 'Remove KML' : 'Delete KML',
            message: file.is_temporary
                ? `Remove ${file.name} from this session? It will not be deleted from disk.`
                : `Are you sure you want to delete ${file.name}? This action cannot be undone.`,
            variant: 'destructive',
            confirmLabel: file.is_temporary ? 'Remove' : 'Delete',
            onConfirm: executeDelete
        })
    }

    // Merge temporary files into the "Imported Files" group
    const getDisplayFiles = () => {
        const displayFiles = { ...kmlFiles }
        if (temporaryKmls.length > 0) {
            const importedGroup = displayFiles["Imported Files"] || []
            const combined = [...importedGroup]
            temporaryKmls.forEach(temp => {
                if (!combined.find(f => f.url === temp.url)) {
                    combined.push(temp)
                }
            })
            displayFiles["Imported Files"] = combined
        }
        return displayFiles
    }

    const displayKmlFiles = getDisplayFiles()

    return (
        <div className="relative" ref={kmlMenuRef}>
            <Button
                variant="secondary"
                size="icon-sm"
                className="!bg-[#1f1f1f] border border-[#414141] shadow-lg hover:!bg-[#333333] !text-[#fafafa]"
                onClick={() => onOpenChange(!isOpen)}
                title="Browse KML Exports"
            >
                <Folder className="h-4 w-4" />
            </Button>

            {isOpen && (
                <div className="absolute top-10 right-0 bg-[#1A1A1A] border border-[#414141] rounded-lg shadow-xl p-0 min-w-[300px] max-h-[400px] flex flex-col overflow-hidden">
                    <div className="bg-[#212121] px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-[#414141]">
                        KML Exports
                    </div>
                    <div className="overflow-y-auto custom-scrollbar bg-[#1A1A1A]">
                        {Object.entries(displayKmlFiles).length === 0 ? (
                            <div className="text-xs text-gray-500 text-center py-6">No KML files found</div>
                        ) : (
                            Object.entries(displayKmlFiles)
                                .sort(([a], [b]) => {
                                    if (a === 'Imported Files') return 1;
                                    if (b === 'Imported Files') return -1;
                                    return a.localeCompare(b);
                                })
                                .map(([groupName, files]) => (
                                    <div key={groupName} className="border-b border-[#262626] last:border-b-0">
                                        <div className="bg-[#1f1f1f] px-3 py-1.5 text-[9px] font-bold text-gray-400/70 uppercase tracking-widest border-b border-[#262626]/50">
                                            {(() => {
                                                const match = groupName.match(/^(.+)\s\(\1\)$/);
                                                return match ? match[1] : groupName;
                                            })()}
                                        </div>
                                        <div className="divide-y divide-[#262626]/30">
                                            {files.map((file) => {
                                                const isSelected = selectedKmlsPaths.includes(file.url)
                                                return (
                                                    <div
                                                        key={file.url}
                                                        className={cn(
                                                            "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors hover:bg-[#2a2a2a] group",
                                                            isSelected && "bg-[#262626]"
                                                        )}
                                                        onClick={() => toggleKmlSelection(file)}
                                                    >
                                                        <div className={cn(
                                                            "w-3.5 h-3.5 border flex items-center justify-center transition-colors rounded flex-shrink-0",
                                                            isSelected ? "bg-white border-white" : "border-gray-500 hover:border-gray-400"
                                                        )}
                                                            style={{ borderWidth: '0.5px' }}
                                                        >
                                                            {isSelected && <Check className="h-2.5 w-2.5 text-black" strokeWidth={4} />}
                                                        </div>

                                                        <div className="flex-1 min-w-0 flex items-center gap-2">
                                                            <span className={cn(
                                                                "text-xs truncate font-medium",
                                                                isSelected ? "text-white" : "text-gray-300 hover:text-white"
                                                            )} title={file.name}>{file.name}</span>

                                                            {file.is_temporary && (
                                                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#333] text-gray-400 border border-[#444] border-opacity-50">
                                                                    Temporary
                                                                </span>
                                                            )}
                                                        </div>

                                                        {file.is_deletable && (
                                                            <button
                                                                onClick={(e) => handleDeleteKml(e, file)}
                                                                className="p-1 rounded hover:bg-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                title={file.is_temporary ? "Remove from session" : "Delete file"}
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5 text-red-400 hover:text-red-300" />
                                                            </button>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                ))
                        )}
                    </div>
                </div>
            )}

            <ConfirmDialog
                config={confirmConfig}
                onClose={hideConfirm}
                onConfirm={handleConfirm}
            />
        </div>
    )
}
