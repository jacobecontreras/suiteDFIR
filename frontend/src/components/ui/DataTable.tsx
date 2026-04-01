import {
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// Virtualization constants
const DEFAULT_ROW_HEIGHT = 49 // Initial estimate, measured dynamically at runtime
const DEFAULT_VIEWPORT_HEIGHT = 448 // Initial estimate, measured dynamically at runtime
const VIRTUALIZATION_THRESHOLD = 120 // Only virtualize when rows exceed this count
const MAX_CONTAINER_HEIGHT = '28rem' // Max height for scroll container

export type SortDirection = 'asc' | 'desc'

type DataTableCell = string | number | Uint8Array | null | ReactNode

type DataTableProps = {
  columns: string[]
  rows: Array<DataTableCell[]>
  emptyMessage: string
  className?: string
  cellClassName?: (props: {
    column: string
    columnIndex: number
    row: DataTableCell[]
    rowIndex: number
    value: DataTableCell
  }) => string | undefined
  columnTooltips?: boolean
  contentClassName?: (props: {
    column: string
    columnIndex: number
    row: DataTableCell[]
    rowIndex: number
    value: DataTableCell
  }) => string | undefined
  getRowKey?: (row: DataTableCell[], rowIndex: number) => string
  highlightTerms?: string[]
  onRowClick?: (row: DataTableCell[], rowIndex: number) => void
  onSort?: (column: string) => void
  renderCell?: (props: {
    column: string
    columnIndex: number
    row: DataTableCell[]
    rowIndex: number
    value: DataTableCell
  }) => ReactNode
  rowClassName?: (row: DataTableCell[], rowIndex: number) => string | undefined
  resizableColumns?: boolean
  scrollClassName?: string
  selectedRowKey?: string | null
  sort?: {
    column: string
    direction: SortDirection
  } | null
  virtualizeRows?: boolean
}

function formatCellValue(value: string | number | Uint8Array | null) {
  if (value === null) {
    return 'NULL'
  }

  if (value instanceof Uint8Array) {
    return `<BLOB ${value.byteLength} bytes>`
  }

  return String(value)
}

function renderHighlightedText(
  value: string,
  pattern: RegExp | null,
  terms: string[],
) {
  if (!pattern || !terms.length) {
    return value
  }

  const parts = value.split(pattern)
  const filteredTerms = terms.filter(Boolean)

  return parts.map((part, index) =>
    filteredTerms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-[#505050] px-1 text-white"
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  )
}

function SortIcon({
  active,
  direction,
}: {
  active: boolean
  direction?: SortDirection
}) {
  if (!active) {
    return <ArrowUpDown className="h-4 w-4 text-[#888]" />
  }

  return direction === 'asc' ? (
    <ArrowUpAZ className="h-4 w-4 text-white" />
  ) : (
    <ArrowDownAZ className="h-4 w-4 text-white" />
  )
}

export function DataTable({
  columns,
  rows,
  emptyMessage,
  className,
  cellClassName,
  columnTooltips = false,
  contentClassName,
  getRowKey,
  highlightTerms = [],
  onRowClick,
  onSort,
  renderCell,
  rowClassName,
  resizableColumns = false,
  scrollClassName,
  selectedRowKey,
  sort,
  virtualizeRows = false,
}: DataTableProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT)
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT)
  const dragStateRef = useRef<{
    column: string
    startWidth: number
    startX: number
  } | null>(null)
  const dragIndicatorRef = useRef<HTMLDivElement | null>(null)
  const tableRef = useRef<HTMLTableElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const overscan = 8
  const shouldVirtualize = virtualizeRows && rows.length > VIRTUALIZATION_THRESHOLD
  const { bottomSpacerHeight, visibleRows, visibleStartIndex } = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        bottomSpacerHeight: 0,
        visibleRows: rows,
        visibleStartIndex: 0,
      }
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
    const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2
    const nextVisibleRows = rows.slice(startIndex, startIndex + visibleCount)
    const remainingRows = Math.max(0, rows.length - (startIndex + nextVisibleRows.length))

    return {
      bottomSpacerHeight: remainingRows * rowHeight,
      visibleRows: nextVisibleRows,
      visibleStartIndex: startIndex,
    }
  }, [rowHeight, rows, scrollTop, shouldVirtualize, viewportHeight])
  const topSpacerHeight = shouldVirtualize ? visibleStartIndex * rowHeight : 0

  // Memoize the highlight pattern to avoid rebuilding on every cell render
  const highlightPattern = useMemo(() => {
    const filteredTerms = highlightTerms.filter(Boolean)
    if (!filteredTerms.length) {
      return null
    }
    return new RegExp(
      `(${filteredTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
      'gi',
    )
  }, [highlightTerms])

  useEffect(() => {
    if (!resizableColumns) {
      return
    }

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current
      if (!dragState) {
        return
      }

      // Calculate bounds so visual indicator doesn't shrink below 96px width for the dragged column
      const minClientX = dragState.startX - (dragState.startWidth - 96)
      const safeClientX = Math.max(minClientX, event.clientX)

      if (dragIndicatorRef.current && scrollContainerRef.current) {
        const containerRect = scrollContainerRef.current.getBoundingClientRect()
        dragIndicatorRef.current.style.left = `${safeClientX - containerRect.left}px`
      }
    }

    const endDrag = (event: MouseEvent) => {
      const dragState = dragStateRef.current
      if (!dragState) {
        return
      }

      // Apply the final calculated width to React state ONCE
      const minClientX = dragState.startX - (dragState.startWidth - 96)
      const safeClientX = Math.max(minClientX, event.clientX)
      const nextWidth = Math.max(96, dragState.startWidth + (safeClientX - dragState.startX))

      setColumnWidths((currentWidths) => ({
        ...currentWidths,
        [dragState.column]: nextWidth,
      }))

      dragStateRef.current = null
      if (dragIndicatorRef.current) {
        dragIndicatorRef.current.style.display = 'none'
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    const handleBlur = () => {
      dragStateRef.current = null
      if (dragIndicatorRef.current) {
        dragIndicatorRef.current.style.display = 'none'
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', endDrag)
    // Also clear drag state on window blur (when user clicks outside browser)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', endDrag)
      window.removeEventListener('blur', handleBlur)
      // Clear drag state and restore body styles if component unmounts during drag
      dragStateRef.current = null
      if (dragIndicatorRef.current) dragIndicatorRef.current.style.display = 'none'
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [resizableColumns])

  // Measure actual row height from the DOM
  useEffect(() => {
    if (!shouldVirtualize || !tableRef.current) {
      return
    }

    const measureRowHeight = () => {
      const tableElement = tableRef.current
      if (!tableElement) return

      const firstRow = tableElement.querySelector('tbody tr')
      if (firstRow) {
        const height = firstRow.getBoundingClientRect().height
        if (height > 0 && height !== rowHeight) {
          setRowHeight(Math.round(height))
        }
      }
    }

    // Measure after a short delay to ensure rendering is complete
    const timeoutId = setTimeout(measureRowHeight, 100)
    return () => clearTimeout(timeoutId)
  }, [shouldVirtualize, rowHeight])

  // Measure viewport height using ResizeObserver
  useEffect(() => {
    if (!shouldVirtualize) {
      return
    }

    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) {
      return
    }

    const syncViewportHeight = () => {
      const height = scrollContainer.clientHeight
      if (height > 0) {
        setViewportHeight((currentHeight) =>
          currentHeight === Math.round(height) ? currentHeight : Math.round(height),
        )
      }
    }

    syncViewportHeight()

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height
        if (height > 0) {
          setViewportHeight((currentHeight) =>
            currentHeight === Math.round(height) ? currentHeight : Math.round(height),
          )
        }
      }
    })

    resizeObserver.observe(scrollContainer)

    return () => {
      resizeObserver.disconnect()
    }
  }, [shouldVirtualize])


  const startColumnResize = (event: ReactMouseEvent<HTMLSpanElement>, column: string) => {
    if (!resizableColumns) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const tableElement = tableRef.current
    const headerIndex = columns.indexOf(column)
    const headerCell = tableElement?.querySelectorAll('th')[headerIndex] as HTMLTableCellElement | undefined
    const startWidth = columnWidths[column] ?? headerCell?.getBoundingClientRect().width ?? 160

    dragStateRef.current = {
      column,
      startWidth,
      startX: event.clientX,
    }

    if (dragIndicatorRef.current && scrollContainerRef.current) {
      const containerRect = scrollContainerRef.current.getBoundingClientRect()
      dragIndicatorRef.current.style.display = 'block'
      dragIndicatorRef.current.style.left = `${event.clientX - containerRect.left}px`
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  if (!columns.length) {
    return (
      <div
        className={cn(
          'flex h-full min-h-0 items-center justify-center rounded-xl border border-white/10 bg-[#2a2a2a] px-4 py-10 text-center text-sm text-[#888]',
          className,
        )}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className={cn('min-h-0 overflow-hidden relative', className)}>
      <div
        ref={dragIndicatorRef}
        className="absolute top-0 bottom-0 w-[2px] shadow-[0_0_4px_#3b82f6] bg-[#3b82f6] z-50 hidden"
        style={{ pointerEvents: 'none' }}
      />
      <div
        ref={scrollContainerRef}
        style={scrollClassName?.includes('h-full') ? undefined : { maxHeight: MAX_CONTAINER_HEIGHT }}
        className={cn('overflow-auto', scrollClassName)}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table ref={tableRef} className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-[#303030] text-white">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  className="px-3 py-2 font-medium whitespace-nowrap"
                  style={
                    columnWidths[column]
                      ? {
                          width: columnWidths[column],
                          minWidth: columnWidths[column],
                        }
                      : undefined
                  }
                >
                  <div className="relative flex items-center">
                    <button
                      type="button"
                      className="inline-flex min-w-0 items-center gap-2 pr-3"
                      onClick={() => onSort?.(column)}
                    >
                      <span className="truncate">{column}</span>
                      <SortIcon
                        active={sort?.column === column}
                        direction={sort?.direction}
                      />
                    </button>
                    {resizableColumns ? (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        className="absolute top-[-8px] right-[-12px] h-[calc(100%+16px)] w-6 cursor-col-resize z-10 hover:bg-white/10"
                        onMouseDown={(event) => startColumnResize(event, column)}
                      />
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight ? (
              <tr>
                <td colSpan={columns.length} style={{ height: topSpacerHeight }} />
              </tr>
            ) : null}
            {visibleRows.map((row, rowIndex) => (
              <tr
                key={
                  getRowKey?.(row, visibleStartIndex + rowIndex) ??
                  `row-${visibleStartIndex + rowIndex}`
                }
                className={cn(
                  onRowClick ? 'cursor-pointer' : '',
                  selectedRowKey &&
                    getRowKey?.(row, visibleStartIndex + rowIndex) === selectedRowKey
                    ? 'bg-[#0b57d0] text-white'
                    : '',
                  rowClassName?.(row, visibleStartIndex + rowIndex),
                )}
                onClick={() => onRowClick?.(row, visibleStartIndex + rowIndex)}
              >
                {row.map((value, columnIndex) => (
                  <td
                    key={`${visibleStartIndex + rowIndex}-${columns[columnIndex]}`}
                    className={cn(
                      'max-w-80 px-3 py-2 align-top text-[#ccc]',
                      cellClassName?.({
                        column: columns[columnIndex],
                        columnIndex,
                        row,
                        rowIndex: visibleStartIndex + rowIndex,
                        value,
                      }),
                    )}
                    style={
                      columnWidths[columns[columnIndex]]
                        ? {
                            width: columnWidths[columns[columnIndex]],
                            minWidth: columnWidths[columns[columnIndex]],
                          }
                        : undefined
                    }
                  >
                    <span
                      className={cn(
                        'block truncate',
                        contentClassName?.({
                          column: columns[columnIndex],
                          columnIndex,
                          row,
                          rowIndex: visibleStartIndex + rowIndex,
                          value,
                        }),
                      )}
                      title={
                        columnTooltips &&
                        !isValidElement(value) &&
                        (typeof value === 'string' ||
                          typeof value === 'number' ||
                          value === null ||
                          value instanceof Uint8Array)
                          ? formatCellValue(value)
                          : undefined
                      }
                    >
                      {renderCell
                        ? renderCell({
                            column: columns[columnIndex],
                            columnIndex,
                            row,
                            rowIndex: visibleStartIndex + rowIndex,
                            value,
                          })
                        : isValidElement(value)
                          ? value
                          : renderHighlightedText(
                              formatCellValue(
                                value as string | number | Uint8Array | null,
                              ),
                              highlightPattern,
                              highlightTerms,
                            )}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
            {bottomSpacerHeight ? (
              <tr>
                <td colSpan={columns.length} style={{ height: bottomSpacerHeight }} />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
