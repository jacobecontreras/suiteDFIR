import { useState, useEffect, useRef } from 'react'
import { Play, PlusSquare, X, PencilLine, Loader2, Download } from 'lucide-react'
import { useDBViewer, QueryResultTab } from '@/context/DBViewerContext'
import { API } from '@/lib/api'
import { useCase } from '@/context/CaseContext'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import { cn } from '@/lib/utils'

const DEFAULT_QUERY = `SELECT name
FROM sqlite_master
WHERE type = 'table'
ORDER BY name;`

export function ExecuteSQLPanel() {
    const { selectedCaseId } = useCase()
    const {
        selectedDatabase,
        queryResults,
        setQueryResults,
        isExecutingQuery,
        setIsExecutingQuery,
        setError,
    } = useDBViewer()

    const [sql, setSql] = useState(DEFAULT_QUERY)
    const [activeResultId, setActiveResultId] = useState<string | null>(null)
    const [editingTabId, setEditingTabId] = useState<string | null>(null)
    const [localError, setLocalError] = useState<string | null>(null)

    // Track the current query generation to prevent stale updates
    const queryIdRef = useRef(0)
    const abortControllerRef = useRef<AbortController | null>(null)
    // Track the current database path to detect changes including to null
    const currentDatabasePathRef = useRef<string | null>(null)

    // Keep the database path ref in sync
    useEffect(() => {
        currentDatabasePathRef.current = selectedDatabase?.relativePath ?? null
    }, [selectedDatabase?.relativePath])

    // Abort any in-flight query when component unmounts
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
                setIsExecutingQuery(false)
            }
        }
    }, [setIsExecutingQuery])

    // Abort query when database changes (including to null)
    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
                abortControllerRef.current = null
                setIsExecutingQuery(false)
            }
        }
    }, [selectedDatabase?.relativePath, setIsExecutingQuery])

    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault()
                runQuery()
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
                e.preventDefault()
                setSql(DEFAULT_QUERY)
                setLocalError(null)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [sql, selectedCaseId, selectedDatabase])

    useEffect(() => {
        setQueryResults([])
        setActiveResultId(null)
        setEditingTabId(null)
        setSql(DEFAULT_QUERY)
        setLocalError(null)
    }, [selectedDatabase, setQueryResults])

    const runQuery = async () => {
        if (!selectedCaseId || !selectedDatabase) {
            setLocalError('No database selected')
            return
        }

        // Increment query ID for this invocation
        const currentQueryId = ++queryIdRef.current

        // Abort any existing query
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }

        setIsExecutingQuery(true)
        setLocalError(null)
        setError(null)

        // Create new AbortController for this query
        const abortController = new AbortController()
        abortControllerRef.current = abortController

        try {
            const params = new URLSearchParams({ db_path: selectedDatabase.relativePath })
            const response = await fetch(
                API.path(`/db_viewer/cases/${selectedCaseId}/databases/query?${params}`),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql }),
                    signal: abortController.signal,
                }
            )

            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.detail || 'Query execution failed')
            }

            const result = await response.json()

            // Only update state if this is still the current query
            if (currentQueryId !== queryIdRef.current) {
                return
            }

            const newTab: QueryResultTab = {
                ...result,
                id: `query-${Date.now()}`,
                name: `Query ${queryResults.length + 1}`,
                sql,
            }

            // Use functional update to avoid stale closure
            setQueryResults((prev) => [...prev, newTab])
            setActiveResultId(newTab.id)
            setEditingTabId(null)
        } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
                return
            }
            const errorMsg = e instanceof Error ? e.message : 'Query execution failed'
            setLocalError(errorMsg)
            setError(errorMsg)
        } finally {
            // Only clear executing state if this is still the active query
            if (currentQueryId === queryIdRef.current) {
                abortControllerRef.current = null
                setIsExecutingQuery(false)
            }
        }
    }

    const closeResultTab = (tabId: string) => {
        const newTabs = queryResults.filter((t) => t.id !== tabId)
        setQueryResults(newTabs)

        if (activeResultId === tabId) {
            setActiveResultId(newTabs.at(-1)?.id || null)
        }

        if (editingTabId === tabId) {
            setEditingTabId(null)
        }
    }

    const closeAllResults = () => {
        setQueryResults([])
        setActiveResultId(null)
        setEditingTabId(null)
    }

    const handleExport = async (format: 'csv' | 'json') => {
        if (!selectedCaseId || !selectedDatabase || !activeResult) return

        try {
            const params = new URLSearchParams({
                db_path: selectedDatabase.relativePath,
                format,
            })

            const response = await fetch(API.path(`/db_viewer/cases/${selectedCaseId}/databases/export?${params}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: activeResult.sql }),
            })

            if (!response.ok) {
                throw new Error(`Export failed: ${response.status}`)
            }

            const data = await response.json()
            const blob = new Blob([data.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${activeResult.name.replace(/[^a-z0-9]/gi, '_')}_export.${format}`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : 'Export failed'
            setLocalError(errorMsg)
            setError(errorMsg)
        }
    }

    const activeResult = queryResults.find((r) => r.id === activeResultId)

    return (
        <div className="h-full w-full flex flex-col bg-[#151515]">
            {/* Error banner - only shown when there's an error */}
            {localError ? (
                <div className="p-3 pb-0">
                    <div className="rounded-lg border border-red-500/50 bg-[#2a2a2a] px-3 py-2 text-sm text-red-400">
                        {localError}
                    </div>
                </div>
            ) : null}

            {/* Side-by-side grid layout */}
            <div className="grid min-h-0 flex-1 gap-3 overflow-hidden p-3 xl:grid-cols-[minmax(320px,0.42fr)_minmax(0,0.58fr)]">
                {/* Left Panel - SQL Editor */}
                <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#333333] bg-[#171717]">
                    <div className="flex h-10 items-center gap-2 border-b border-[#333333] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[#888] bg-[#1A1A1A]">
                        SQL Editor
                    </div>

                    <textarea
                        value={sql}
                        onChange={(e) => setSql(e.target.value)}
                        spellCheck={false}
                        className="min-h-0 flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-5 text-white outline-none placeholder:text-[#666]"
                        placeholder="SELECT * FROM your_table LIMIT 100;"
                    />

                    <div className="flex h-[52px] items-center justify-between gap-3 border-t border-[#333333] px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-[#888]">
                            Cmd/Ctrl + Enter executes
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setSql(DEFAULT_QUERY)}>
                                <PlusSquare className="h-4 w-4" />
                                New Query
                            </Button>
                            <Button size="sm" onClick={runQuery} disabled={!selectedDatabase || isExecutingQuery}>
                                {isExecutingQuery ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Play className="h-4 w-4" />
                                )}
                                {isExecutingQuery ? 'Running...' : 'Execute'}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Right Panel - Results */}
                <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[#333333] bg-[#171717]">
                    {/* Results header with tabs */}
                    <div className="flex h-10 items-center justify-between gap-3 border-b border-[#333333] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[#888] bg-[#1A1A1A]">
                        <div className="inline-flex min-w-0 items-center gap-2">
                            <span className="shrink-0">Results</span>
                        </div>
                        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                            <div className="scrollbar-none min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
                                <div className="flex min-w-max items-center justify-end gap-2 pr-1">
                                    {queryResults.length > 0
                                        ? queryResults.map((tab) => {
                                            const isActive = tab.id === activeResult?.id
                                            const isEditing = editingTabId === tab.id

                                            return (
                                                <div
                                                    key={tab.id}
                                                    className={cn(
                                                        "flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] normal-case tracking-normal",
                                                        isActive
                                                            ? 'border-[#444] bg-[#262626] text-white'
                                                            : 'border-[#333] bg-[#1A1A1A] text-[#888]'
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        className="min-w-0 max-w-36 truncate font-medium"
                                                        onClick={() => {
                                                            setActiveResultId(tab.id)
                                                            setSql(tab.sql)
                                                        }}
                                                    >
                                                        {isEditing ? (
                                                            <input
                                                                autoFocus
                                                                value={tab.name}
                                                                onChange={(e) => {
                                                                    const updated = queryResults.map((t) =>
                                                                        t.id === tab.id ? { ...t, name: e.target.value } : t
                                                                    )
                                                                    setQueryResults(updated)
                                                                }}
                                                                onBlur={() => setEditingTabId(null)}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') setEditingTabId(null)
                                                                }}
                                                                className="min-w-16 bg-transparent outline-none text-white"
                                                            />
                                                        ) : (
                                                            tab.name
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="text-[#888] transition-colors hover:text-white"
                                                        onClick={() => setEditingTabId(tab.id)}
                                                    >
                                                        <PencilLine className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="text-[#888] transition-colors hover:text-white"
                                                        onClick={() => closeResultTab(tab.id)}
                                                    >
                                                        <X className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            )
                                        })
                                        : null}
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0 normal-case tracking-normal"
                                onClick={closeAllResults}
                                disabled={!queryResults.length}
                            >
                                Close All
                            </Button>
                        </div>
                    </div>

                    {/* Results table */}
                    <div className="min-h-0 flex-1 overflow-hidden">
                        {activeResult ? (
                            <DataTable
                                columns={activeResult.columns}
                                rows={activeResult.rows}
                                className="h-full rounded-none border-0 bg-transparent"
                                columnTooltips
                                emptyMessage="The active result tab returned no rows."
                                scrollClassName="h-full max-h-full"
                                virtualizeRows
                            />
                        ) : (
                            <DataTable
                                columns={[]}
                                rows={[]}
                                className="flex h-full items-center justify-center rounded-none border-0 bg-transparent"
                                emptyMessage={
                                    selectedDatabase
                                        ? isExecutingQuery
                                            ? 'Executing query...'
                                            : 'Run a read-only query to create a result tab.'
                                        : 'Select a database to execute SQL.'
                                }
                            />
                        )}
                    </div>

                    {/* Stats footer */}
                    <div className="flex h-[52px] items-center justify-between gap-3 border-t border-[#333333] px-3 py-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.18em] text-[#888]">
                            <span>
                                Rows:{' '}
                                <span className="font-medium text-white">
                                    {activeResult?.rowCount ?? 0}
                                </span>
                            </span>
                            <span>
                                Columns:{' '}
                                <span className="font-medium text-white">
                                    {activeResult?.columns.length ?? 0}
                                </span>
                            </span>
                            <span>
                                Time:{' '}
                                <span className="font-medium text-white">
                                    {activeResult ? `${activeResult.durationMs.toFixed(1)} ms` : '0.0 ms'}
                                </span>
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            {activeResult && (
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleExport('csv')}
                                        className="h-8 px-2"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        CSV
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleExport('json')}
                                        className="h-8 px-2"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        JSON
                                    </Button>
                                </div>
                            )}
                            <span className="truncate text-right text-[11px] uppercase tracking-[0.18em] text-[#888]">
                                Active:{' '}
                                <span className="font-medium text-white">
                                    {activeResult?.name ?? 'None'}
                                </span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
