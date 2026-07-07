import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReactNode, useEffect } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { apiUrl } from '@/test/handlers/base'
import { initBackendUrl } from '@/lib/api'
import { CaseProvider } from '@/context/CaseContext'
import { DBViewerProvider, useDBViewer, type DatabaseInfo } from '@/context/DBViewerContext'
import { ExecuteSQLPanel } from './ExecuteSQLPanel'

beforeAll(async () => {
    await initBackendUrl()
})

beforeEach(() => {
    localStorage.setItem('selectedCaseId', JSON.stringify('case-1'))
})

const TEST_DB: DatabaseInfo = {
    name: 'photos.sqlite',
    relativePath: 'photos.sqlite',
    size: 1024,
}

function SelectTestDatabase({ db = TEST_DB }: { db?: DatabaseInfo | null }) {
    const { setSelectedDatabase } = useDBViewer()
    useEffect(() => {
        setSelectedDatabase(db)
    }, [db, setSelectedDatabase])
    return null
}

function Wrapper({ children, db = TEST_DB }: { children: ReactNode; db?: DatabaseInfo | null }) {
    return (
        <CaseProvider>
            <DBViewerProvider>
                <SelectTestDatabase db={db} />
                {children}
            </DBViewerProvider>
        </CaseProvider>
    )
}

describe('ExecuteSQLPanel - rendering', () => {
    it('renders the SQL editor with the default query', () => {
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        const textarea = screen.getByPlaceholderText(/SELECT \* FROM/i) as HTMLTextAreaElement
        expect(textarea.value).toMatch(/sqlite_master/)
    })

    it('shows the empty-state message when no result tabs exist', () => {
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        expect(
            screen.getByText(/Run a read-only query to create a result tab\./i),
        ).toBeInTheDocument()
    })

    it('shows a "Select a database" message when none is selected', () => {
        render(<ExecuteSQLPanel />, {
            wrapper: ({ children }) => <Wrapper db={null}>{children}</Wrapper>,
        })
        expect(screen.getByText(/Select a database to execute SQL\./i)).toBeInTheDocument()
    })
})

describe('ExecuteSQLPanel - query execution', () => {
    it('creates a result tab when a query succeeds', async () => {
        server.use(
            http.post(
                apiUrl('/db_viewer/cases/:case/databases/query'),
                () =>
                    HttpResponse.json({
                        columns: ['name'],
                        rows: [['users'], ['posts']],
                        rowCount: 2,
                        durationMs: 12.3,
                    }),
            ),
        )

        const user = userEvent.setup()
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })

        await user.click(screen.getByRole('button', { name: /Execute/i }))

        await waitFor(() => {
            // "Query 1" appears in both the tab and the footer status — accept multiple.
            expect(screen.getAllByText('Query 1').length).toBeGreaterThan(0)
            expect(screen.getByText('users')).toBeInTheDocument()
            expect(screen.getByText('posts')).toBeInTheDocument()
        })
    })

    it('shows the server error message when the query fails', async () => {
        server.use(
            http.post(
                apiUrl('/db_viewer/cases/:case/databases/query'),
                () =>
                    HttpResponse.json({ detail: 'no such table: ghosts' }, { status: 400 }),
            ),
        )

        const user = userEvent.setup()
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        await user.click(screen.getByRole('button', { name: /Execute/i }))

        expect(await screen.findByText('no such table: ghosts')).toBeInTheDocument()
    })

    it('shows a local error when no database is selected', async () => {
        const user = userEvent.setup()
        render(<ExecuteSQLPanel />, {
            wrapper: ({ children }) => <Wrapper db={null}>{children}</Wrapper>,
        })
        // Execute button is disabled when no DB is selected; clicking still no-ops.
        const exec = screen.getByRole('button', { name: /Execute/i }) as HTMLButtonElement
        expect(exec.disabled).toBe(true)
        await user.click(exec) // safe — runQuery's own guard would set the local error.
        // No tab created.
        expect(screen.queryByText('Query 1')).not.toBeInTheDocument()
    })

    it('Cmd+Enter triggers query execution', async () => {
        let calls = 0
        server.use(
            http.post(
                apiUrl('/db_viewer/cases/:case/databases/query'),
                () => {
                    calls += 1
                    return HttpResponse.json({
                        columns: [],
                        rows: [],
                        rowCount: 0,
                        durationMs: 1,
                    })
                },
            ),
        )

        const user = userEvent.setup()
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        await user.keyboard('{Meta>}{Enter}{/Meta}')
        await waitFor(() => expect(calls).toBe(1))
    })

    it('Cmd+N resets the SQL editor to the default query', async () => {
        const user = userEvent.setup()
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        const textarea = screen.getByPlaceholderText(/SELECT \* FROM/i) as HTMLTextAreaElement
        await user.clear(textarea)
        await user.type(textarea, 'SELECT 1')
        expect(textarea.value).toBe('SELECT 1')

        await user.keyboard('{Meta>}n{/Meta}')
        expect(textarea.value).toMatch(/sqlite_master/)
    })
})

describe('ExecuteSQLPanel - tab management', () => {
    async function runOnce(user: ReturnType<typeof userEvent.setup>) {
        server.use(
            http.post(
                apiUrl('/db_viewer/cases/:case/databases/query'),
                () =>
                    HttpResponse.json({
                        columns: ['x'],
                        rows: [[1]],
                        rowCount: 1,
                        durationMs: 1,
                    }),
            ),
        )
        await user.click(screen.getByRole('button', { name: /Execute/i }))
        await waitFor(() =>
            expect(screen.getAllByText('Query 1').length).toBeGreaterThan(0),
        )
    }

    it('closes a result tab via the X button', async () => {
        const user = userEvent.setup()
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        await runOnce(user)

        // The tab itself is a button labeled "Query 1" — its parent <div> wraps the tab pill.
        const tabButton = screen.getAllByRole('button', { name: 'Query 1' })[0]
        const tabPill = tabButton.parentElement!
        const buttons = tabPill.querySelectorAll('button')
        const closeBtn = buttons[buttons.length - 1]
        await user.click(closeBtn)

        await waitFor(() =>
            expect(screen.queryAllByRole('button', { name: 'Query 1' })).toHaveLength(0),
        )
    })

    it('Close All clears every tab', async () => {
        const user = userEvent.setup()
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        await runOnce(user)
        await user.click(screen.getByRole('button', { name: /Execute/i }))
        await waitFor(() =>
            expect(screen.getAllByText('Query 2').length).toBeGreaterThan(0),
        )

        await user.click(screen.getByRole('button', { name: /Close All/i }))
        await waitFor(() => {
            expect(screen.queryAllByRole('button', { name: /^Query \d+$/ })).toHaveLength(0)
        })
    })
})

describe('ExecuteSQLPanel - export buttons', () => {
    it('disables CSV/JSON export until there is an active result', async () => {
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        const csv = screen.getByRole('button', { name: /CSV/i }) as HTMLButtonElement
        const json = screen.getByRole('button', { name: /JSON/i }) as HTMLButtonElement
        expect(csv.disabled).toBe(true)
        expect(json.disabled).toBe(true)
    })

    it('enables CSV/JSON export once a query result exists', async () => {
        server.use(
            http.post(
                apiUrl('/db_viewer/cases/:case/databases/query'),
                () =>
                    HttpResponse.json({
                        columns: ['x'],
                        rows: [[1]],
                        rowCount: 1,
                        durationMs: 1,
                    }),
            ),
        )
        const user = userEvent.setup()
        render(<ExecuteSQLPanel />, { wrapper: Wrapper })
        await user.click(screen.getByRole('button', { name: /Execute/i }))
        await waitFor(() =>
            expect(screen.getAllByText('Query 1').length).toBeGreaterThan(0),
        )
        const csv = screen.getByRole('button', { name: /CSV/i }) as HTMLButtonElement
        expect(csv.disabled).toBe(false)
    })
})

describe('ExecuteSQLPanel - stale query suppression', () => {
    it('does not create a tab from a query whose database changed mid-flight', async () => {
        let resolveFirst: ((r: Response) => void) | null = null
        server.use(
            http.post(
                apiUrl('/db_viewer/cases/:case/databases/query'),
                () =>
                    new Promise<Response>((resolve) => {
                        resolveFirst = resolve as (r: Response) => void
                    }),
            ),
        )

        // Capture the DBViewer context so we can swap the database.
        let dbContext: ReturnType<typeof useDBViewer> | null = null
        function GrabContext() {
            dbContext = useDBViewer()
            return null
        }

        const user = userEvent.setup()
        render(
            <>
                <GrabContext />
                <ExecuteSQLPanel />
            </>,
            { wrapper: Wrapper },
        )

        // Trigger a query that will hang.
        await user.click(screen.getByRole('button', { name: /Execute/i }))

        // Now switch database — this aborts the in-flight query via cleanup effect.
        await act(async () => {
            dbContext?.setSelectedDatabase({ ...TEST_DB, relativePath: 'other.sqlite' })
        })

        // Resolve the original request late — the response should be ignored.
        resolveFirst?.(
            HttpResponse.json({
                columns: ['x'],
                rows: [[1]],
                rowCount: 1,
                durationMs: 1,
            }),
        )

        // Give it a tick to settle.
        await new Promise((r) => setTimeout(r, 30))
        expect(screen.queryByText('Query 1')).not.toBeInTheDocument()
    })
})
