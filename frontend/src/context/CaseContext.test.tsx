import { beforeAll, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'
import { apiUrl } from '@/test/handlers/base'
import { initBackendUrl } from '@/lib/api'
import { CaseProvider, useCase } from './CaseContext'

beforeAll(async () => {
    await initBackendUrl()
})

function Probe() {
    const { cases, selectedCaseId, setSelectedCaseId } = useCase()
    return (
        <div>
            <div data-testid="count">{cases.length}</div>
            <div data-testid="selected">{selectedCaseId ?? 'none'}</div>
            <button onClick={() => setSelectedCaseId('case-99')}>pick</button>
        </div>
    )
}

describe('CaseContext', () => {
    it('throws when useCase is called outside the provider', () => {
        const Bad = () => {
            useCase()
            return null
        }
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(() => render(<Bad />)).toThrow(/useCase must be used within a CaseProvider/)
    })

    it('fetches /api/cases on mount and exposes the result', async () => {
        server.use(
            http.get(apiUrl('/cases'), () =>
                HttpResponse.json([
                    { id: '1', name: 'Alpha' },
                    { id: '2', name: 'Beta' },
                ]),
            ),
        )

        render(
            <CaseProvider>
                <Probe />
            </CaseProvider>,
        )

        await waitFor(() => {
            expect(screen.getByTestId('count').textContent).toBe('2')
        })
    })

    it('starts with null selectedCaseId when localStorage is empty', () => {
        render(
            <CaseProvider>
                <Probe />
            </CaseProvider>,
        )
        expect(screen.getByTestId('selected').textContent).toBe('none')
    })

    it('hydrates selectedCaseId from localStorage', async () => {
        localStorage.setItem('selectedCaseId', JSON.stringify('saved-case'))
        render(
            <CaseProvider>
                <Probe />
            </CaseProvider>,
        )
        await waitFor(() => {
            expect(screen.getByTestId('selected').textContent).toBe('saved-case')
        })
    })

    it('persists changes to selectedCaseId back into localStorage', async () => {
        render(
            <CaseProvider>
                <Probe />
            </CaseProvider>,
        )
        const btn = screen.getByText('pick')
        await act(async () => {
            btn.click()
        })
        await waitFor(() => {
            expect(localStorage.getItem('selectedCaseId')).toBe(JSON.stringify('case-99'))
        })
    })

    it('does not throw on a fetch failure', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        server.use(
            http.get(apiUrl('/cases'), () => HttpResponse.error()),
        )
        render(
            <CaseProvider>
                <Probe />
            </CaseProvider>,
        )
        await waitFor(() => {
            expect(screen.getByTestId('count').textContent).toBe('0')
        })
    })

    it('ignores non-ok responses', async () => {
        server.use(
            http.get(apiUrl('/cases'), () => HttpResponse.json({}, { status: 500 })),
        )
        render(
            <CaseProvider>
                <Probe />
            </CaseProvider>,
        )
        // Counts remain at 0 (initial) — no throw, no crash.
        expect(screen.getByTestId('count').textContent).toBe('0')
    })
})
