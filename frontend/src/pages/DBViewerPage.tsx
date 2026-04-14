import { useEffect, useState } from 'react'
import { LoadingPage } from '@/components/ui/LoadingPage'
import { DBViewerProvider, useDBViewer } from '@/context/DBViewerContext'
import { useCase } from '@/context/CaseContext'
import { API } from '@/lib/api'
import { DBViewerMain } from '@/components/db-viewer/DBViewerMain'
import type { DatabaseInfo } from '@/context/DBViewerContext'

function DBViewerContent() {
    const { selectedCaseId } = useCase()
    const {
        setAvailableDatabases,
        setError,
        setSelectedDatabase,
        availableDatabases,
        selectedDatabase,
    } = useDBViewer()

    const [isLoading, setIsLoading] = useState(false)

    // Load databases when case changes
    useEffect(() => {
        if (!selectedCaseId) {
            setAvailableDatabases([])
            setSelectedDatabase(null)
            return
        }

        const loadDatabases = async () => {
            setIsLoading(true)
            setError(null)

            try {
                const response = await fetch(
                    API.path(`/db_viewer/cases/${selectedCaseId}/databases`)
                )

                if (!response.ok) {
                    throw new Error(`API Error: ${response.status}`)
                }

                const data = await response.json()
                const databases: DatabaseInfo[] = data.databases || []

                setAvailableDatabases(databases)

                // Auto-select first database if available
                if (databases.length > 0 && !selectedDatabase) {
                    setSelectedDatabase(databases[0])
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to load databases')
                setAvailableDatabases([])
            } finally {
                setIsLoading(false)
            }
        }

        loadDatabases()
    }, [selectedCaseId, setAvailableDatabases, setSelectedDatabase, setError])

    const handleDatabaseChange = (value: string) => {
        const db = availableDatabases.find((d) => d.relativePath === value)
        if (db) {
            setSelectedDatabase(db)
        }
    }

    if (!selectedCaseId) {
        return (
            <div className="h-full w-full flex items-center justify-center text-gray-500 py-[3vh] px-[9vh]">
                <p className="text-lg">Select a case to view databases</p>
            </div>
        )
    }

    if (isLoading) {
        return (
            <div className="h-full w-full flex items-center justify-center">
                <LoadingPage />
            </div>
        )
    }

    if (availableDatabases.length === 0) {
        return (
            <div className="h-full w-full flex items-center justify-center text-gray-500 py-[3vh] px-[9vh]">
                <p className="text-lg">No databases found</p>
            </div>
        )
    }

    return (
        <div className="h-full w-full flex flex-col bg-[#151515] py-[3vh] px-[9vh] text-white">
            <DBViewerMain
                availableDatabases={availableDatabases}
                selectedDatabase={selectedDatabase}
                onDatabaseChange={handleDatabaseChange}
            />
        </div>
    )
}

export default function DBViewerPage() {
    return (
        <DBViewerProvider>
            <DBViewerContent />
        </DBViewerProvider>
    )
}
