import { useEffect, useState, useMemo } from 'react'
import {
    ChevronDown,
    ChevronRight,
    Search,
    TableProperties,
    Tags,
    Zap,
    Eye,
    Key,
    Hash,
    Download
} from 'lucide-react'
import { useDBViewer } from '@/context/DBViewerContext'
import { API } from '@/lib/api'
import { useCase } from '@/context/CaseContext'
import { cn } from '@/lib/utils'
import { DataTable } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/Button'

type GroupKey = 'tables' | 'indexes' | 'views' | 'triggers'

interface StructureRow {
    id: string
    group: GroupKey
    kind: 'group' | 'table' | 'table-detail' | 'object'
    name: string
    objectType: string
    schema: string
    count?: number
    parentTable?: string
    detailType?: 'column' | 'index' | 'foreignKey'
}

const STRUCTURE_COLUMNS = ['Name', 'Type', 'Schema']

function normalizeForSearch(value: string) {
    return value.toLowerCase()
}

export function StructurePanel() {
    const { selectedCaseId } = useCase()
    const {
        selectedDatabase,
        schema,
        setSchema,
        isLoadingSchema,
        setIsLoadingSchema,
        setError,
        expandedTables,
        setExpandedTables
    } = useDBViewer()

    const [search, setSearch] = useState('')
    const [expandedGroups, setExpandedGroups] = useState<Record<GroupKey, boolean>>({
        tables: true,
        indexes: false,
        views: false,
        triggers: false,
    })

    useEffect(() => {
        if (!selectedCaseId || !selectedDatabase) {
            setSchema(null)
            return
        }

        const loadSchema = async () => {
            setIsLoadingSchema(true)
            setError(null)

            try {
                const params = new URLSearchParams({ db_path: selectedDatabase.relativePath })
                const response = await fetch(
                    API.path(`/db_viewer/cases/${selectedCaseId}/databases/schema?${params}`)
                )

                if (!response.ok) {
                    throw new Error(`API Error: ${response.status}`)
                }

                const data = await response.json()
                setSchema(data)
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to load schema')
                setSchema(null)
            } finally {
                setIsLoadingSchema(false)
            }
        }

        loadSchema()
    }, [selectedCaseId, selectedDatabase, setSchema, setIsLoadingSchema, setError])

    const toggleGroup = (key: GroupKey) => {
        setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
    }

    const toggleTable = (tableName: string) => {
        setExpandedTables((prev) => ({ ...prev, [tableName]: !prev[tableName] }))
    }

    const handleExport = async (format: 'csv' | 'json') => {
        if (!selectedCaseId || !selectedDatabase) return

        try {
            const params = new URLSearchParams({
                db_path: selectedDatabase.relativePath,
                format,
            })

            // Export the schema as a query result
            const response = await fetch(API.path(`/db_viewer/cases/${selectedCaseId}/databases/export?${params}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sql: `SELECT name, type, sql FROM sqlite_master UNION ALL
                           SELECT 'Tables', COUNT(*), '' FROM sqlite_master WHERE type = 'table'
                           UNION ALL
                           SELECT 'Indexes', COUNT(*), '' FROM sqlite_master WHERE type = 'index'
                           UNION ALL
                           SELECT 'Views', COUNT(*), '' FROM sqlite_master WHERE type = 'view'
                           UNION ALL
                           SELECT 'Triggers', COUNT(*), '' FROM sqlite_master WHERE type = 'trigger'`
                }),
            })

            if (!response.ok) {
                throw new Error(`Export failed: ${response.status}`)
            }

            const data = await response.json()
            const blob = new Blob([data.data], { type: format === 'csv' ? 'text/csv' : 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${selectedDatabase.name}_schema_export.${format}`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Export failed')
        }
    }

    // Filter schema based on search
    const filteredSchema = useMemo(() => {
        if (!schema || !search.trim()) {
            return schema
        }

        const query = normalizeForSearch(search)

        // For tables, search across all nested properties
        const tables = schema.tables.filter((table) => {
            const searchable = [
                table.name,
                table.sql || '',
                ...table.columns.flatMap((c) => [c.name, c.type]),
                ...table.indexes.flatMap((i) => [i.name, ...i.columns]),
                ...table.foreignKeys.flatMap((fk) => [fk.table, fk.from_column, fk.to]),
            ].join(' ').toLowerCase()

            return searchable.includes(query)
        })

        const indexes = schema.indexes.filter((idx) =>
            `${idx.name} ${idx.sql}`.toLowerCase().includes(query)
        )

        const views = schema.views.filter((view) =>
            `${view.name} ${view.sql}`.toLowerCase().includes(query)
        )

        const triggers = schema.triggers.filter((trigger) =>
            `${trigger.name} ${trigger.sql}`.toLowerCase().includes(query)
        )

        return { tables, indexes, views, triggers }
    }, [schema, search])

    // Build rows for DataTable
    const rows = useMemo(() => {
        if (!filteredSchema) {
            return []
        }

        const result: StructureRow[] = []

        // Helper to add group header
        const addGroup = (key: GroupKey, label: string, items: any[]) => {
            result.push({
                id: `${key}-group`,
                group: key,
                kind: 'group',
                name: label,
                objectType: '',
                schema: '',
                count: items.length,
            })

            if (!expandedGroups[key]) {
                return
            }

            items.forEach((item) => {
                result.push({
                    id: `${key}-${item.name}`,
                    group: key,
                    kind: key === 'tables' ? 'table' : 'object',
                    name: item.name,
                    objectType: key === 'tables' ? 'table' : key.slice(0, -1),
                    schema: item.sql || '-- SQL definition unavailable',
                })
            })
        }

        // Tables with expandable details
        const tablesGroup = {
            key: 'tables' as GroupKey,
            label: 'Tables',
            items: filteredSchema.tables,
        }

        result.push({
            id: 'tables-group',
            group: 'tables',
            kind: 'group',
            name: tablesGroup.label,
            objectType: '',
            schema: '',
            count: tablesGroup.items.length,
        })

        if (expandedGroups.tables) {
            filteredSchema.tables.forEach((table) => {
                const isExpanded = expandedTables[table.name]

                result.push({
                    id: `tables-${table.name}`,
                    group: 'tables',
                    kind: 'table',
                    name: table.name,
                    objectType: 'table',
                    schema: table.sql || '-- SQL definition unavailable',
                })

                if (isExpanded) {
                    // Add columns
                    table.columns.forEach((column) => {
                        result.push({
                            id: `tables-${table.name}-column-${column.cid}`,
                            group: 'tables',
                            kind: 'table-detail',
                            name: column.name,
                            objectType: 'column',
                            schema: `${column.type}${column.notNull ? ' NOT NULL' : ''}${
                                column.primaryKeyPosition > 0 ? ' PRIMARY KEY' : ''
                            }${column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''}`,
                            parentTable: table.name,
                            detailType: 'column',
                        })
                    })

                    // Add indexes
                    table.indexes.forEach((index) => {
                        result.push({
                            id: `tables-${table.name}-index-${index.name}`,
                            group: 'tables',
                            kind: 'table-detail',
                            name: index.name,
                            objectType: 'index',
                            schema: `ON (${index.columns.join(', ')})${
                                index.unique ? ' UNIQUE' : ''
                            }`,
                            parentTable: table.name,
                            detailType: 'index',
                        })
                    })

                    // Add foreign keys
                    table.foreignKeys.forEach((fk, idx) => {
                        result.push({
                            id: `tables-${table.name}-fk-${idx}`,
                            group: 'tables',
                            kind: 'table-detail',
                            name: `${fk.from_column} → ${fk.table}.${fk.to}`,
                            objectType: 'foreign key',
                            schema: `REFERENCES ${fk.table}(${fk.to}) ON UPDATE ${fk.on_update} ON DELETE ${fk.on_delete}`,
                            parentTable: table.name,
                            detailType: 'foreignKey',
                        })
                    })
                }
            })
        }

        // Indexes, Views, Triggers (simple groups)
        addGroup('indexes', 'Indexes', filteredSchema.indexes)
        addGroup('views', 'Views', filteredSchema.views)
        addGroup('triggers', 'Triggers', filteredSchema.triggers)

        return result
    }, [filteredSchema, expandedGroups, expandedTables])

    // Convert rows to DataTable format
    const tableData = useMemo(() => {
        return rows.map((row) => [row.name, row.objectType, row.schema])
    }, [rows])

    const getRowKey = (_row: unknown, rowIndex: number) => rows[rowIndex]?.id ?? `row-${rowIndex}`

    const handleRowClick = (_row: unknown, rowIndex: number) => {
        const row = rows[rowIndex]
        if (!row) return

        if (row.kind === 'group') {
            toggleGroup(row.group)
        } else if (row.kind === 'table') {
            toggleTable(row.name)
        }
    }

    if (isLoadingSchema) {
        return (
            <div className="h-full w-full flex items-center justify-center">
                <div className="text-[#888] text-sm">Loading schema...</div>
            </div>
        )
    }

    if (!schema) {
        return (
            <div className="h-full w-full flex items-center justify-center">
                <div className="text-[#888] text-sm">No schema available</div>
            </div>
        )
    }

    return (
        <div className="h-full w-full flex flex-col gap-3 bg-[#151515]">
            {/* Search bar */}
            <div className="flex flex-wrap items-center gap-2">
                    <label className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-[#2a2a2a] px-3 h-9 text-xs text-[#888] lg:w-80">
                        <Search className="h-4 w-4 shrink-0" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="w-full min-w-0 bg-transparent text-white outline-none placeholder:text-[#666]"
                            placeholder="Search schema objects"
                        />
                    </label>
                    <div className="flex items-center gap-2 ml-auto">
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
                </div>
            {/* Schema table */}
            <div className="flex-1 min-h-0 overflow-hidden">
                <DataTable
                    columns={STRUCTURE_COLUMNS}
                    rows={tableData}
                    emptyMessage="No schema objects match the current search."
                    getRowKey={getRowKey}
                    onRowClick={handleRowClick}
                    className="h-full border border-[#333333] rounded-lg"
                    scrollClassName="h-full max-h-full"
                    cellClassName={({ column }) =>
                        column === 'Schema' ? 'max-w-none whitespace-nowrap' : undefined
                    }
                    contentClassName={({ column }) =>
                        column === 'Schema' ? 'overflow-visible whitespace-nowrap' : undefined
                    }
                    renderCell={({ column, rowIndex, value }) => {
                        const row = rows[rowIndex]
                        if (!row) return value

                        if (column === 'Name') {
                            let Icon = TableProperties

                            if (row.kind === 'group') {
                                Icon = TableProperties
                            } else if (row.detailType === 'column') {
                                Icon = Hash
                            } else if (row.detailType === 'index') {
                                Icon = Zap
                            } else if (row.detailType === 'foreignKey') {
                                Icon = Key
                            } else if (row.group === 'tables') {
                                Icon = TableProperties
                            } else if (row.group === 'indexes') {
                                Icon = Tags
                            } else if (row.group === 'views') {
                                Icon = Eye
                            } else if (row.group === 'triggers') {
                                Icon = Zap
                            }

                            const paddingLeft = row.kind === 'group'
                                ? 'pl-0'
                                : row.detailType
                                    ? 'pl-12'
                                    : 'pl-5'

                            return (
                                <div className={cn('flex items-center gap-2', paddingLeft)}>
                                    {row.kind === 'group' ? (
                                        expandedGroups[row.group] ? (
                                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#888]" />
                                        ) : (
                                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#888]" />
                                        )
                                    ) : row.kind === 'table' ? (
                                        expandedTables[row.name] ? (
                                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#888]" />
                                        ) : (
                                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#888]" />
                                        )
                                    ) : (
                                        <span className="w-3.5 shrink-0" />
                                    )}
                                    <Icon className="h-3.5 w-3.5 shrink-0 text-[#888]" />
                                    <span className="truncate font-medium text-white">
                                        {row.kind === 'group'
                                            ? `${row.name} (${row.count ?? 0})`
                                            : String(value)}
                                    </span>
                                </div>
                            )
                        }

                        if (row.kind === 'group') {
                            return ''
                        }

                        return value
                    }}
                />
            </div>
        </div>
    )
}
