import { useState, useRef } from "react"
import { Upload, Loader2, X, FileText, Eye, Save } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/utils"
import { API } from "@/lib/api"
import { useToast } from "@/hooks/useToast"
import { useClickOutside } from "@/hooks/useClickOutside"
import { parseKmlText } from "@/lib/kmlUtils"
import {
    MAX_SPATIAL_FEATURES,
    MAX_SPATIAL_FILE_SIZE_BYTES,
    MAX_SPATIAL_IMPORT_FILES,
    MAX_SPATIAL_TOTAL_SIZE_BYTES,
    formatBytes,
} from "@/lib/spatialLimits"
import JSZip from "jszip"
import type { KmlFile } from "./KmlBrowser"

interface ImportPanelProps {
    selectedCaseId: string | null
    onImportComplete: (files: KmlFile[]) => void
    onSaveComplete: () => void
}

export default function ImportPanel({ selectedCaseId, onImportComplete, onSaveComplete }: ImportPanelProps) {
    const { toast } = useToast()
    const [showImportMenu, setShowImportMenu] = useState(false)
    const [importFiles, setImportFiles] = useState<File[]>([])
    const [isDraggingImport, setIsDraggingImport] = useState(false)
    const [isProcessingImport, setIsProcessingImport] = useState(false)
    const importMenuRef = useRef<HTMLDivElement>(null)
    const importFileInputRef = useRef<HTMLInputElement>(null)

    useClickOutside(
        [importMenuRef],
        () => setShowImportMenu(false),
        { enabled: showImportMenu }
    )

    const handleImportDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDraggingImport(true)
    }

    const handleImportDragLeave = () => {
        setIsDraggingImport(false)
    }

    const handleImportDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDraggingImport(false)
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            validateAndAddFiles(Array.from(e.dataTransfer.files))
        }
    }

    const handleImportFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            validateAndAddFiles(Array.from(e.target.files))
        }
    }

    const validateAndAddFiles = (selectedFiles: File[]) => {
        if (importFiles.length >= MAX_SPATIAL_IMPORT_FILES) {
            toast({
                variant: "destructive",
                title: "Import limit reached",
                description: `You can queue up to ${MAX_SPATIAL_IMPORT_FILES} spatial files at once.`,
            })
            return
        }

        const validFiles = selectedFiles.filter(file => {
            const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
            return ['.kml', '.kmz'].includes(ext)
        })

        const oversizeFile = validFiles.find(file => file.size > MAX_SPATIAL_FILE_SIZE_BYTES)
        if (oversizeFile) {
            toast({
                variant: "destructive",
                title: "File too large",
                description: `${oversizeFile.name} exceeds the ${formatBytes(MAX_SPATIAL_FILE_SIZE_BYTES)} import limit.`,
            })
            return
        }

        const availableSlots = MAX_SPATIAL_IMPORT_FILES - importFiles.length
        const nextFiles = validFiles.slice(0, availableSlots)
        const nextTotalSize = [...importFiles, ...nextFiles].reduce((sum, file) => sum + file.size, 0)

        if (nextTotalSize > MAX_SPATIAL_TOTAL_SIZE_BYTES) {
            toast({
                variant: "destructive",
                title: "Import queue too large",
                description: `Queued spatial files cannot exceed ${formatBytes(MAX_SPATIAL_TOTAL_SIZE_BYTES)} total.`,
            })
            return
        }

        if (nextFiles.length > 0) {
            setImportFiles(prev => [...prev, ...nextFiles])
        }

        if (validFiles.length > nextFiles.length) {
            toast({
                title: "Some files were skipped",
                description: `Only the first ${availableSlots} additional files were added.`,
            })
        }
    }

    const removeImportFile = (index: number) => {
        setImportFiles(prev => prev.filter((_, i) => i !== index))
    }

    const resetImport = () => {
        setImportFiles([])
        setShowImportMenu(false)
        if (importFileInputRef.current) importFileInputRef.current.value = ''
    }

    const handleViewTemporarily = async () => {
        if (importFiles.length === 0) return
        setIsProcessingImport(true)

        try {
            const tempFiles: KmlFile[] = []
            for (const file of importFiles) {
                let kmlText = ""
                if (file.name.endsWith('.kml')) {
                    kmlText = await file.text()
                } else if (file.name.endsWith('.kmz')) {
                    const zip = await JSZip.loadAsync(file)
                    const kmlFile = Object.values(zip.files).find(f => f.name.endsWith('.kml'))
                    if (kmlFile) {
                        kmlText = await kmlFile.async('string')
                    } else {
                        throw new Error(`No KML file found in ${file.name}`)
                    }
                }
                const geojson = parseKmlText(kmlText)
                const featureCount = 'features' in geojson && Array.isArray(geojson.features) ? geojson.features.length : 0
                if (featureCount > MAX_SPATIAL_FEATURES) {
                    toast({
                        variant: "destructive",
                        title: "Spatial file too dense",
                        description: `${file.name} has ${featureCount.toLocaleString()} features. Limit is ${MAX_SPATIAL_FEATURES.toLocaleString()}.`,
                    })
                    continue
                }
                tempFiles.push({
                    name: file.name,
                    url: `temp://${Date.now()}-${file.name}`,
                    path: "",
                    is_deletable: true,
                    is_temporary: true,
                    data: geojson
                })
            }
            onImportComplete(tempFiles)
            resetImport()
        } catch (error) {
            console.error("Failed to parse file:", error)
            toast({
                variant: "destructive",
                title: "Import failed",
                description: error instanceof Error ? error.message : "Failed to parse the selected spatial file.",
            })
        } finally {
            setIsProcessingImport(false)
        }
    }

    const handleSaveAndView = async () => {
        if (importFiles.length === 0) return
        setIsProcessingImport(true)

        try {
            for (const file of importFiles) {
                const formData = new FormData()
                formData.append("file", file)
                const res = await fetch(API.path("/spatial/import"), {
                    method: "POST",
                    body: formData
                })
                if (!res.ok) {
                    const errorData = await res.json().catch(() => null)
                    throw new Error(errorData?.detail || `Failed to save ${file.name}`)
                }
            }
            resetImport()
            onSaveComplete()
        } catch (error) {
            console.error("Failed to save files:", error)
            toast({
                variant: "destructive",
                title: "Import failed",
                description: error instanceof Error ? error.message : "Failed to save one or more spatial files.",
            })
        } finally {
            setIsProcessingImport(false)
        }
    }

    return (
        <div className="relative" ref={importMenuRef}>
            <Button
                variant="secondary"
                size="icon-sm"
                className="!bg-[#1f1f1f] border border-[#414141] shadow-lg hover:!bg-[#333333] !text-[#fafafa]"
                onClick={() => setShowImportMenu(!showImportMenu)}
                title="Import KML/KMZ"
            >
                {isProcessingImport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            </Button>

            {showImportMenu && (
                <div className="absolute top-10 right-0 bg-[#1A1A1A] border border-[#414141] rounded-lg shadow-xl min-w-[320px] max-w-[360px] flex flex-col overflow-hidden">
                    <div className="bg-[#212121] px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wider border-b border-[#414141]">
                        Import Spatial Data
                    </div>
                    <div className="p-3">
                        {importFiles.length === 0 ? (
                            <div
                                onDragOver={handleImportDragOver}
                                onDragLeave={handleImportDragLeave}
                                onDrop={handleImportDrop}
                                onClick={() => importFileInputRef.current?.click()}
                                className={cn(
                                    "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-all duration-200 group",
                                    isDraggingImport
                                        ? "border-gray-500 bg-[#262626]"
                                        : "border-[#333] hover:border-[#444] hover:bg-[#1f1f1f]"
                                )}
                            >
                                <input
                                    ref={importFileInputRef}
                                    type="file"
                                    accept=".kml,.kmz"
                                    multiple
                                    className="hidden"
                                    onChange={handleImportFileSelect}
                                />
                                <div className="w-10 h-10 rounded-full bg-[#262626] flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                    <Upload className="w-4 h-4 text-gray-500 group-hover:text-gray-300" />
                                </div>
                                <p className="text-xs font-medium text-gray-400">Click to upload or drag & drop</p>
                                <p className="text-[10px] text-gray-600 mt-1">.kml, .kmz (multiple files)</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-gray-500">
                                        {importFiles.length} file{importFiles.length !== 1 ? 's' : ''} ({(importFiles.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1)} KB)
                                    </span>
                                    <button
                                        onClick={() => setImportFiles([])}
                                        className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                                    >
                                        Clear
                                    </button>
                                </div>
                                <div className="max-h-[120px] overflow-y-auto space-y-1 custom-scrollbar">
                                    {importFiles.map((file, index) => (
                                        <div
                                            key={`${file.name}-${index}`}
                                            className="bg-[#212121] rounded-md p-2 border border-[#333] flex items-center justify-between"
                                        >
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <div className="w-6 h-6 rounded bg-[#262626] flex items-center justify-center flex-shrink-0">
                                                    <FileText className="w-3 h-3 text-gray-400" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-[10px] font-medium text-gray-300 truncate">{file.name}</p>
                                                    <p className="text-[9px] text-gray-600">{(file.size / 1024).toFixed(1)} KB</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => removeImportFile(index)}
                                                className="p-1 hover:bg-[#333] rounded-full transition-colors"
                                            >
                                                <X className="w-3 h-3 text-gray-500 hover:text-gray-300" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={() => importFileInputRef.current?.click()}
                                    className="w-full py-1.5 text-[10px] text-gray-500 hover:text-gray-300 border border-[#333] hover:border-[#444] rounded-md transition-colors"
                                >
                                    + Add more
                                </button>
                                <input
                                    ref={importFileInputRef}
                                    type="file"
                                    accept=".kml,.kmz"
                                    multiple
                                    className="hidden"
                                    onChange={handleImportFileSelect}
                                />
                            </div>
                        )}

                        <div className="mt-3 flex gap-2">
                            <Button
                                onClick={handleViewTemporarily}
                                disabled={importFiles.length === 0 || isProcessingImport}
                                variant="secondary"
                                size="sm"
                                className="flex-1 !bg-[#262626] hover:!bg-[#333] text-gray-300 !border-[#444] !h-8 !text-[10px]"
                            >
                                <Eye className="w-3 h-3 mr-1" />
                                Temporary
                            </Button>
                            <Button
                                onClick={handleSaveAndView}
                                disabled={importFiles.length === 0 || isProcessingImport}
                                size="sm"
                                className="flex-1 !bg-[#333] hover:!bg-[#444] text-gray-200 !border-[#555] !h-8 !text-[10px]"
                            >
                                {isProcessingImport ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
                                Save to Case
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
