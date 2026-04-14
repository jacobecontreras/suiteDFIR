import { createContext, useContext, useState, useCallback, Dispatch, SetStateAction, ReactNode } from 'react'

// Types for database viewer state
export type TabType = 'structure' | 'browse' | 'execute'

export interface DatabaseInfo {
    name: string
    relativePath: string
    size: number
    tableCount?: number
}

export interface TableInfo {
    name: string
    sql?: string
    columns: ColumnInfo[]
    indexes: IndexInfo[]
    foreignKeys: ForeignKeyInfo[]
    rowCount: number
}

export interface ColumnInfo {
    cid: number
    name: string
    type: string
    notNull: boolean
    defaultValue?: string
    primaryKeyPosition: number
}

export interface IndexInfo {
    name: string
    unique: boolean
    origin: string
    partial: boolean
    columns: string[]
}

export interface ForeignKeyInfo {
    table: string
    from_column: string
    to: string
    on_update: string
    on_delete: string
    match: string
}

export interface DatabaseSchema {
    tables: TableInfo[]
    indexes: TriggerInfo[]
    views: TriggerInfo[]
    triggers: TriggerInfo[]
}

export interface TriggerInfo {
    name: string
    sql: string
    table?: string
}

export interface QueryResult {
    columns: string[]
    rows: Array<Array<any>>
    rowCount: number
    durationMs: number
}

// Extended type for query result tabs
export interface QueryResultTab extends QueryResult {
    id: string
    name: string
    sql: string
}

export interface TableData {
    columns: string[]
    rows: Array<Array<any>>
    rowCount: number
    page: number
    pageSize: number
}

interface DBViewerContextType {
    // State
    activeTab: TabType
    setActiveTab: (tab: TabType) => void
    selectedDatabase: DatabaseInfo | null
    setSelectedDatabase: (db: DatabaseInfo | null) => void
    availableDatabases: DatabaseInfo[]
    setAvailableDatabases: (dbs: DatabaseInfo[]) => void
    selectedTable: string | null
    setSelectedTable: (table: string | null) => void

    // Structure panel state
    expandedTables: Record<string, boolean>
    setExpandedTables: Dispatch<SetStateAction<Record<string, boolean>>>
    selectedObject: { type: string; name: string } | null
    setSelectedObject: (obj: { type: string; name: string } | null) => void

    // Data
    schema: DatabaseSchema | null
    setSchema: (schema: DatabaseSchema | null) => void
    tableData: TableData | null
    setTableData: (data: TableData | null) => void
    queryResults: QueryResultTab[]
    setQueryResults: (results: QueryResultTab[] | ((prev: QueryResultTab[]) => QueryResultTab[])) => void

    // Loading states
    isLoadingSchema: boolean
    setIsLoadingSchema: (loading: boolean) => void
    isLoadingTableData: boolean
    setIsLoadingTableData: (loading: boolean) => void
    isExecutingQuery: boolean
    setIsExecutingQuery: (executing: boolean) => void

    // Error state
    error: string | null
    setError: (error: string | null) => void
}

const DBViewerContext = createContext<DBViewerContextType | undefined>(undefined)

export function DBViewerProvider({ children }: { children: ReactNode }) {
    const [activeTab, setActiveTab] = useState<TabType>('structure')
    const [selectedDatabase, setSelectedDatabase] = useState<DatabaseInfo | null>(null)
    const [availableDatabases, setAvailableDatabases] = useState<DatabaseInfo[]>([])
    const [selectedTable, setSelectedTable] = useState<string | null>(null)

    // Structure panel state
    const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({})
    const [selectedObject, setSelectedObject] = useState<{ type: string; name: string } | null>(null)

    const [schema, setSchema] = useState<DatabaseSchema | null>(null)
    const [tableData, setTableData] = useState<TableData | null>(null)
    const [queryResults, setQueryResults] = useState<QueryResultTab[]>([])

    const [isLoadingSchema, setIsLoadingSchema] = useState(false)
    const [isLoadingTableData, setIsLoadingTableData] = useState(false)
    const [isExecutingQuery, setIsExecutingQuery] = useState(false)

    const [error, setError] = useState<string | null>(null)

    // Reset database-specific state when database changes
    const handleSetSelectedDatabase = useCallback((db: DatabaseInfo | null) => {
        setSelectedDatabase(db)
        setSchema(null)
        setTableData(null)
        setQueryResults([])
        setSelectedTable(null)
        setExpandedTables({})
        setSelectedObject(null)
        setError(null)
    }, [])

    const value: DBViewerContextType = {
        activeTab,
        setActiveTab,
        selectedDatabase,
        setSelectedDatabase: handleSetSelectedDatabase,
        availableDatabases,
        setAvailableDatabases,
        selectedTable,
        setSelectedTable,

        expandedTables,
        setExpandedTables,
        selectedObject,
        setSelectedObject,

        schema,
        setSchema,
        tableData,
        setTableData,
        queryResults,
        setQueryResults,

        isLoadingSchema,
        setIsLoadingSchema,
        isLoadingTableData,
        setIsLoadingTableData,
        isExecutingQuery,
        setIsExecutingQuery,

        error,
        setError,
    }

    return (
        <DBViewerContext.Provider value={value}>
            {children}
        </DBViewerContext.Provider>
    )
}

export function useDBViewer() {
    const context = useContext(DBViewerContext)
    if (context === undefined) {
        throw new Error('useDBViewer must be used within a DBViewerProvider')
    }
    return context
}
