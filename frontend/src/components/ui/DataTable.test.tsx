import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTable } from './DataTable'

describe('DataTable', () => {
    it('renders an empty-state message when columns is empty', () => {
        render(<DataTable columns={[]} rows={[]} emptyMessage="Nothing here." />)
        expect(screen.getByText('Nothing here.')).toBeInTheDocument()
    })

    it('renders columns and rows', () => {
        render(
            <DataTable
                columns={['id', 'name']}
                rows={[
                    [1, 'Alice'],
                    [2, 'Bob'],
                ]}
                emptyMessage="empty"
            />,
        )
        expect(screen.getByText('id')).toBeInTheDocument()
        expect(screen.getByText('name')).toBeInTheDocument()
        expect(screen.getByText('Alice')).toBeInTheDocument()
        expect(screen.getByText('Bob')).toBeInTheDocument()
    })

    it('formats null as "NULL"', () => {
        render(
            <DataTable columns={['v']} rows={[[null]]} emptyMessage="empty" />,
        )
        expect(screen.getByText('NULL')).toBeInTheDocument()
    })

    it('formats Uint8Array as "<BLOB N bytes>"', () => {
        const blob = new Uint8Array([1, 2, 3, 4, 5])
        render(<DataTable columns={['v']} rows={[[blob]]} emptyMessage="empty" />)
        expect(screen.getByText('<BLOB 5 bytes>')).toBeInTheDocument()
    })

    it('calls onSort with the header name when a column header is clicked', async () => {
        const onSort = vi.fn()
        render(
            <DataTable
                columns={['id', 'name']}
                rows={[[1, 'Alice']]}
                emptyMessage="empty"
                onSort={onSort}
            />,
        )
        await userEvent.click(screen.getByRole('button', { name: /^name$/ }))
        expect(onSort).toHaveBeenCalledWith('name')
    })

    it('calls onRowClick with the row and original index', async () => {
        const onRowClick = vi.fn()
        render(
            <DataTable
                columns={['id']}
                rows={[[1], [2], [3]]}
                emptyMessage="empty"
                onRowClick={onRowClick}
            />,
        )
        await userEvent.click(screen.getByText('2'))
        expect(onRowClick).toHaveBeenCalledWith([2], 1)
    })

    it('wraps matching highlightTerms in <mark>', () => {
        const { container } = render(
            <DataTable
                columns={['v']}
                rows={[['hello world hello']]}
                emptyMessage="empty"
                highlightTerms={['hello']}
            />,
        )
        const marks = container.querySelectorAll('mark')
        expect(marks).toHaveLength(2)
        marks.forEach((m) => expect(m.textContent).toBe('hello'))
    })

    it('is case-insensitive when highlighting', () => {
        const { container } = render(
            <DataTable
                columns={['v']}
                rows={[['Hello hello HELLO']]}
                emptyMessage="empty"
                highlightTerms={['hello']}
            />,
        )
        expect(container.querySelectorAll('mark')).toHaveLength(3)
    })

    it('escapes regex meta-characters in highlight terms', () => {
        const { container } = render(
            <DataTable
                columns={['v']}
                rows={[['price: $5.00 and $5.00']]}
                emptyMessage="empty"
                highlightTerms={['$5.00']}
            />,
        )
        expect(container.querySelectorAll('mark')).toHaveLength(2)
    })

    it('renderCell prop overrides default rendering', () => {
        render(
            <DataTable
                columns={['v']}
                rows={[[42]]}
                emptyMessage="empty"
                renderCell={({ value }) => <em data-testid="custom">x={String(value)}</em>}
            />,
        )
        expect(screen.getByTestId('custom').textContent).toBe('x=42')
    })

    it('selectedRowKey highlights the matching row', () => {
        const { container } = render(
            <DataTable
                columns={['id']}
                rows={[[1], [2]]}
                emptyMessage="empty"
                getRowKey={(row) => `r${row[0]}`}
                selectedRowKey="r2"
            />,
        )
        const rows = container.querySelectorAll('tbody tr')
        expect(rows[1].className).toContain('bg-[#0b57d0]')
        expect(rows[0].className).not.toContain('bg-[#0b57d0]')
    })

    it('shows the active sort icon on the sorted column', () => {
        const { container } = render(
            <DataTable
                columns={['name']}
                rows={[['x']]}
                emptyMessage="empty"
                sort={{ column: 'name', direction: 'desc' }}
            />,
        )
        // ArrowDownAZ icon has the text-white class when active descending.
        const headerButton = container.querySelector('thead button')
        expect(headerButton?.innerHTML).toContain('text-white')
    })

    it('does not virtualize when row count is under the threshold', () => {
        const rows = Array.from({ length: 50 }, (_, i) => [i])
        const { container } = render(
            <DataTable columns={['i']} rows={rows} emptyMessage="empty" virtualizeRows />,
        )
        const bodyRows = container.querySelectorAll('tbody tr')
        expect(bodyRows.length).toBe(50)
    })

    it('honors columnTooltips by setting a title attribute on string values', () => {
        const { container } = render(
            <DataTable
                columns={['v']}
                rows={[['hello']]}
                emptyMessage="empty"
                columnTooltips
            />,
        )
        const span = container.querySelector('tbody span')
        expect(span?.getAttribute('title')).toBe('hello')
    })

    it('starts a column resize drag on mousedown of the resize handle', () => {
        const { container } = render(
            <DataTable
                columns={['name']}
                rows={[['x']]}
                emptyMessage="empty"
                resizableColumns
            />,
        )
        const handle = container.querySelector('[role="separator"]')
        expect(handle).not.toBeNull()
        fireEvent.mouseDown(handle as Element, { clientX: 100 })
        // After mousedown, the body should be set to col-resize cursor.
        expect(document.body.style.cursor).toBe('col-resize')
        // Clean up the drag state.
        fireEvent.mouseUp(window, { clientX: 100 })
    })
})
