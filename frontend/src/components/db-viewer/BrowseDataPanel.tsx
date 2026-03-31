import { useEffect, useState, useDeferredValue, useRef } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Database, Filter, Download } from 'lucide-react'
import { useDBViewer } from '@/context/DBViewerContext'
import { API } from '@/lib/api'
import { useCase } from '@/context/CaseContext'
import { cn } from '@/lib/utils'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { DataTable } from '@/components/ui/DataTable'
import type { SortDirection } from '@/components/ui/DataTable'

const PAGE_SIZE = 50

export function BrowseDataPanel() {
    const { selectedCaseId } = useCase()
    const {
        selectedDatabase,
        selectedTable,
        setSelectedTable,
        schema,
        tableData,
        setTableData,
        isLoadingTableData,
        setIsLoadingTableData,
        setError,
    } = useDBViewer()

    const [pageIndex, setPageIndex] = useState(0)
    const [globalFilter, setGlobalFilter] = useState('')
    const [sortColumn, setSortColumn] = useState<string | null>(null)
    const [sortDirection, setSortDirection] = useState<SortDirection | null>(null)
    const [goToPageValue, setGoToPageValue] = useState('1')

    // Track the current request generation to prevent stale updates
    const requestIdRef = useRef(0)

    // Deferred filter for better performance
    const deferredGlobalFilter = useDeferredValue(globalFilter)

    // Sync go-to-page input with current page
    useEffect(() => {
        setGoToPageValue(String(pageIndex + 1))
    }, [pageIndex])

    // Auto-select first table when schema loads
    useEffect(() => {
        if (schema?.tables?.length && !selectedTable) {
            setSelectedTable(schema.tables[0].name)
        }
    }, [schema, selectedTable, setSelectedTable])

    useEffect(() => {
        if (!selectedCaseId || !selectedDatabase || !selectedTable) {
            setTableData(null)
            setIsLoadingTableData(false)
            return
        }

        // Increment request ID for this effect invocation
        const currentRequestId = ++requestIdRef.current
        const abortController = new AbortController()

        const loadData = async () => {
            setIsLoadingTableData(true)
            setError(null)

            try {
                const params = new URLSearchParams({
                    db_path: selectedDatabase.relativePath,
                    table_name: selectedTable,
                    page: String(pageIndex),
                    page_size: String(PAGE_SIZE),
                })

                if (deferredGlobalFilter) {
                    params.append('global_filter', deferredGlobalFilter)
                }

                if (sortColumn) {
                    params.append('sort_column', sortColumn)
                    params.append('sort_direction', sortDirection || 'asc')
                }

                const response = await fetch(
                    API.path(`/db_viewer/cases/${selectedCaseId}/databases/data?${params}`),
                    { signal: abortController.signal }
                )

                if (!response.ok) {
                    throw new Error(`API Error: ${response.status}`)
                }

                const data = await response.json()

                // Only update state if this is still the current request
                if (currentRequestId === requestIdRef.current) {
                    setTableData(data)
                }
            } catch (e) {
                // Don't update state for aborted requests
                if (e instanceof Error && e.name === 'AbortError') {
                    return
                }
                // Only update error state if this is still the current request
                if (currentRequestId === requestIdRef.current) {
                    setError(e instanceof Error ? e.message : 'Failed to load table data')
                    setTableData(null)
                }
            } finally {
                // Only clear loading state if this is still the current request
                if (currentRequestId === requestIdRef.current) {
                    setIsLoadingTableData(false)
                }
            }
        }

        loadData()

        return () => {
            abortController.abort()
            // Clear loading state if this was the current request
            if (currentRequestId === requestIdRef.current) {
                setIsLoadingTableData(false)
            }
        }
    }, [selectedCaseId, selectedDatabase, selectedTable, pageIndex, deferredGlobalFilter, sortColumn, sortDirection, setIsLoadingTableData, setError, setTableData])

    const pageCount = tableData ? Math.ceil(tableData.rowCount / PAGE_SIZE) : 1
    const pageStart = tableData && tableData.rowCount > 0 ? pageIndex * PAGE_SIZE + 1 : 0
    const pageEnd = tableData ? Math.min((pageIndex + 1) * PAGE_SIZE, tableData.rowCount) : 0

    const handleSort = (column: string) => {
        setPageIndex(0)
        if (sortColumn === column) {
            if (sortDirection === 'asc') {
                setSortDirection('desc')
            } else if (sortDirection === 'desc') {
                setSortColumn(null)
                setSortDirection(null)
            } else {
                setSortColumn(column)
                setSortDirection('asc')
            }
        } else {
            setSortColumn(column)
            setSortDirection('asc')
        }
    }

    const handleGoToPage = () => {
        if (!selectedTable) {
            return
        }

        const parsedValue = Number.parseInt(goToPageValue, 10)
        if (Number.isNaN(parsedValue)) {
            setGoToPageValue(String(pageIndex + 1))
            return
        }

        const nextPage = Math.min(Math.max(parsedValue, 1), pageCount)
        setPageIndex(nextPage - 1)
        setGoToPageValue(String(nextPage))
    }

    const handleExport = async (format: 'csv' | 'json') => {
        if (!selectedCaseId || !selectedDatabase || !selectedTable) return

        try {
            const params = new URLSearchParams({
                db_path: selectedDatabase.relativePath,
                format,
            })

            const response = await fetch(API.path(`/db_viewer/cases/${selectedCaseId}/databases/export?${params}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: `SELECT * FROM "${selectedTable}"` }),
            })

            if (!response.ok) {
                throw new Error(`Export failed: ${response.status}`)
            }

            const data = await response.json()
            const blob = new Blob([data.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${selectedTable}_export.${format}`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Export failed')
        }
    }

    if (!selectedDatabase) {
        return (
            <div className="h-full w-full flex items-center justify-center text-[#888]">
                <div className="text-center">
                    <Database className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg">No database selected</p>
                </div>
            </div>
        )
    }

    const tables = schema?.tables || []
    const hasData = tableData && tableData.rows.length > 0

    return (
        <div className="h-full w-full flex flex-col bg-[#151515]">
            {/* Toolbar */}
            <div className="flex flex-col gap-3 p-3 pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {/* Table selector - always shown when database is selected */}
                        <Select value={selectedTable || ''} onValueChange={setSelectedTable}>
                            <SelectTrigger className="min-w-56 h-9 bg-[#2a2a2a] border border-white/10 text-white rounded-lg">
                                <SelectValue placeholder="Choose a table" />
                            </SelectTrigger>
                            <SelectContent className="bg-[#2a2a2a] border border-white/10 max-h-[300px] rounded-lg">
                                {tables.map((table) => (
                                    <SelectItem key={table.name} value={table.name} className="text-white rounded-md">
                                        {table.name} ({table.rowCount} rows)
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {/* Filter input - only shown when table is selected */}
                        {selectedTable && (
                            <label className="flex min-w-56 items-center gap-2 rounded-lg border border-white/10 bg-[#2a2a2a] px-3 h-9 text-xs text-[#888]">
                                <Filter className="h-4 w-4 shrink-0" />
                                <input
                                    type="text"
                                    value={globalFilter}
                                    onChange={(e) => setGlobalFilter(e.target.value)}
                                    placeholder="Filter rows"
                                    className="w-full min-w-0 bg-transparent text-white outline-none placeholder:text-[#666]"
                                />
                            </label>
                        )}
                    </div>

                    {/* Export buttons - only shown when table is selected */}
                    {selectedTable && (
                        <div className="flex items-center gap-2">
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleExport('csv')}
                                className="h-9"
                            >
                                <Download className="h-4 w-4" />
                                CSV
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleExport('json')}
                                className="h-9"
                            >
                                <Download className="h-4 w-4" />
                                JSON
                            </Button>
                        </div>
                    )}
                </div>
            </div>

            {/* Data table */}
            <div className="flex-1 overflow-hidden min-h-0 px-3 pt-3 pb-3">
                {!selectedTable ? (
                    <div className="h-full flex items-center justify-center text-[#888]">
                        Choose a table to browse its data.
                    </div>
                ) : isLoadingTableData ? (
                    <div className="h-full flex items-center justify-center text-[#888]">
                        Loading table data...
                    </div>
                ) : !tableData || tableData.rows.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[#888]">
                        No data found
                    </div>
                ) : (
                    <DataTable
                        columns={tableData.columns}
                        rows={tableData.rows}
                        className="h-full"
                        columnTooltips
                        emptyMessage="No data found"
                        highlightTerms={[deferredGlobalFilter]}
                        onSort={handleSort}
                        resizableColumns
                        scrollClassName="h-full max-h-full"
                        sort={sortColumn && sortDirection ? { column: sortColumn, direction: sortDirection } : null}
                        virtualizeRows
                    />
                )}
            </div>

            {/* Pagination controls */}
            {selectedTable && tableData && (
                <div className="border-t border-white/10 px-3 py-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        {/* Row count info */}
                        <p className="flex h-9 items-center gap-1.5 text-xs text-[#888]">
                            <span>Showing</span>
                            <span className="font-medium text-white">{pageStart}</span>
                            <span aria-hidden="true">-</span>
                            <span className="font-medium text-white">{pageEnd}</span>
                            <span>of</span>
                            <span className="font-medium text-white">{tableData.rowCount}</span>
                            <span>rows</span>
                        </p>

                        {/* Pagination buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPageIndex(0)}
                                disabled={pageIndex === 0 || isLoadingTableData}
                                className="h-9"
                            >
                                <ChevronsLeft className="h-4 w-4" />
                                First
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                                disabled={pageIndex === 0 || isLoadingTableData}
                                className="h-9"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <span className="flex h-9 items-center gap-1.5 px-2 text-xs text-[#888]">
                                <span>Page</span>
                                <span className="font-medium text-white">{pageIndex + 1}</span>
                                <span>of</span>
                                <span className="font-medium text-white">{pageCount}</span>
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
                                disabled={pageIndex >= pageCount - 1 || isLoadingTableData}
                                className="h-9"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setPageIndex(pageCount - 1)}
                                disabled={pageIndex >= pageCount - 1 || isLoadingTableData}
                                className="h-9"
                            >
                                Last
                                <ChevronsRight className="h-4 w-4" />
                            </Button>
                            <div className="flex h-9 items-center gap-2 rounded-lg px-2">
                                <span className="text-xs text-[#888]">Go to</span>
                                <input
                                    value={goToPageValue}
                                    onChange={(e) => setGoToPageValue(e.target.value.replace(/[^\d]/g, ''))}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            handleGoToPage()
                                        }
                                    }}
                                    className="h-9 w-14 rounded-lg border border-white/10 bg-[#2a2a2a] px-2 text-center text-xs text-white outline-none focus:border-white/20"
                                    inputMode="numeric"
                                    disabled={isLoadingTableData}
                                />
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleGoToPage}
                                    disabled={isLoadingTableData}
                                    className="h-9"
                                >
                                    Go
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
