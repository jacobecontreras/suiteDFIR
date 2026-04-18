import { useState, useCallback, useRef } from 'react'
import { API } from '@/lib/api'
import { useEventSourceStream } from './useEventSourceStream'

interface ExtractionProgress {
    current: number
    total: number
    phase: string
}

interface UsePhotosExtractionReturn {
    isExtracting: boolean
    logs: string[]
    progress: ExtractionProgress | null
    taskId: string | null
    extractionId: number | null
    startExtraction: (backupId: number, caseId: number, password?: string, name?: string, selectedArtifacts?: string[]) => Promise<{ extractionId: number } | null>
    clearLogs: () => void
}

export function usePhotosExtraction(): UsePhotosExtractionReturn {
    const [isExtracting, setIsExtracting] = useState(false)
    const [extractionId, setExtractionId] = useState<number | null>(null)
    const [logs, setLogs] = useState<string[]>([])
    const [progress, setProgress] = useState<ExtractionProgress | null>(null)
    const [taskId, setTaskId] = useState<string | null>(null)
    const stream = useEventSourceStream()
    const extractionIdRef = useRef<number | null>(null)

    const clearLogs = useCallback(() => {
        setLogs([])
        setProgress(null)
    }, [])

    const startExtraction = useCallback(async (
        backupId: number,
        caseId: number,
        password?: string,
        name?: string,
        selectedArtifacts?: string[],
    ): Promise<{ extractionId: number } | null> => {
        setIsExtracting(true)
        setLogs([])
        setProgress(null)

        try {
            const res = await fetch(API.path('/photos/extract'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    backup_id: backupId,
                    case_id: caseId,
                    password: password || null,
                    name: name || null,
                    selected_artifacts: selectedArtifacts || null,
                }),
            })

            if (!res.ok) {
                const err = await res.json()
                setLogs(prev => [...prev, `Error: ${err.detail}`])
                setIsExtracting(false)
                return null
            }

            const data = await res.json()
            const { task_id, extraction_id } = data
            setTaskId(task_id)
            setExtractionId(extraction_id)
            extractionIdRef.current = extraction_id

            // Connect SSE stream
            const source = new EventSource(API.path(`/photos/extract/stream/${task_id}`))
            stream.connect('extraction', source, {
                onMessage: (event) => {
                    try {
                        const parsed = JSON.parse(event.data)
                        if (parsed.type === 'log') {
                            setLogs(prev => [...prev, parsed.message])
                        } else if (parsed.type === 'progress') {
                            setProgress({
                                current: parsed.current,
                                total: parsed.total,
                                phase: parsed.phase,
                            })
                        }
                    } catch {
                        // Plain text message
                        setLogs(prev => [...prev, event.data])
                    }
                },
                onClose: () => {
                    setIsExtracting(false)
                },
                onError: () => {
                    setIsExtracting(false)
                },
            })

            return { extractionId: extraction_id }
        } catch (e) {
            setLogs(prev => [...prev, `Failed to start extraction: ${e}`])
            setIsExtracting(false)
            return null
        }
    }, [stream])

    return {
        isExtracting,
        logs,
        progress,
        taskId,
        extractionId,
        startExtraction,
        clearLogs,
    }
}
