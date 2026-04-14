import { useCallback } from 'react'
import { API } from '@/lib/api'

/**
 * Shared export logic for db-viewer panels.
 * Calls the backend export endpoint with a SQL query, then triggers a file download.
 */
export function useDbExport(
    selectedCaseId: string | null,
    dbPath: string | undefined,
    onError: (message: string) => void,
) {
    const exportData = useCallback(async (
        format: 'csv' | 'json',
        sql: string,
        filename: string,
    ) => {
        if (!selectedCaseId || !dbPath) return

        try {
            const params = new URLSearchParams({ db_path: dbPath, format })

            const response = await fetch(
                API.path(`/db_viewer/cases/${selectedCaseId}/databases/export?${params}`),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql }),
                },
            )

            if (!response.ok) {
                throw new Error(`Export failed: ${response.status}`)
            }

            const data = await response.json()
            const blob = new Blob(
                [data.data],
                { type: format === 'csv' ? 'text/csv' : 'application/json' },
            )
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${filename}.${format}`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e) {
            onError(e instanceof Error ? e.message : 'Export failed')
        }
    }, [selectedCaseId, dbPath, onError])

    return exportData
}
