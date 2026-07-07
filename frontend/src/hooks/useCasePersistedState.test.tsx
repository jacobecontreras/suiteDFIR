import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ReactNode } from 'react'
import { CaseProvider } from '@/context/CaseContext'
import { useCase } from '@/context/CaseContext'
import { useCasePersistedState } from './useCasePersistedState'

function wrapper({ children }: { children: ReactNode }) {
    return <CaseProvider>{children}</CaseProvider>
}

describe('useCasePersistedState', () => {
    it('session storage key includes the case id', () => {
        localStorage.setItem('selectedCaseId', JSON.stringify('case-42'))
        const { result } = renderHook(
            () => useCasePersistedState<number>('counter', 0, 'session'),
            { wrapper },
        )
        act(() => result.current[1](9))
        expect(sessionStorage.getItem('counter_case-42')).toBe('9')
    })

    it('does nothing when no case is selected (session)', () => {
        const { result } = renderHook(
            () => useCasePersistedState<number>('counter', 0, 'session'),
            { wrapper },
        )
        act(() => result.current[1](9))
        expect(sessionStorage.getItem('counter')).toBeNull()
    })

    it('writes to localStorage when storageType is local', () => {
        localStorage.setItem('selectedCaseId', JSON.stringify('case-1'))
        const { result } = renderHook(
            () => useCasePersistedState<number>('counter', 0, 'local'),
            { wrapper },
        )
        act(() => result.current[1](3))
        expect(localStorage.getItem('counter')).toBe('3')
    })

    it('isolates state between cases', () => {
        const Combined = () => {
            const ctx = useCase()
            const [value, set] = useCasePersistedState<string>('note', 'init', 'session')
            return { ctx, value, set }
        }

        localStorage.setItem('selectedCaseId', JSON.stringify('A'))
        const { result, rerender } = renderHook(() => Combined(), { wrapper })

        act(() => result.current.set('value-A'))
        expect(sessionStorage.getItem('note_A')).toBe(JSON.stringify('value-A'))

        act(() => result.current.ctx.setSelectedCaseId('B'))
        rerender()

        act(() => result.current.set('value-B'))
        expect(sessionStorage.getItem('note_B')).toBe(JSON.stringify('value-B'))
        expect(sessionStorage.getItem('note_A')).toBe(JSON.stringify('value-A'))
    })
})
