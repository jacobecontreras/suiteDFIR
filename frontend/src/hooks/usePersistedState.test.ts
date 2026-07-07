import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { usePersistedState } from './usePersistedState'

describe('usePersistedState', () => {
    it('uses initialState when no value is stored', () => {
        const { result } = renderHook(() =>
            usePersistedState<string>('k', 'default', localStorage),
        )
        const [value, , loaded] = result.current
        expect(value).toBe('default')
        expect(loaded).toBe(true)
    })

    it('hydrates state from storage on mount', () => {
        localStorage.setItem('k', JSON.stringify('stored'))
        const { result } = renderHook(() =>
            usePersistedState<string>('k', 'default', localStorage),
        )
        expect(result.current[0]).toBe('stored')
    })

    it('accepts an initialState factory', () => {
        const factory = vi.fn(() => 'lazy')
        renderHook(() => usePersistedState<string>('k', factory, localStorage))
        expect(factory).toHaveBeenCalled()
    })

    it('persists updates back to storage', () => {
        const { result } = renderHook(() =>
            usePersistedState<number>('count', 0, localStorage),
        )
        act(() => result.current[1](7))
        expect(localStorage.getItem('count')).toBe('7')
    })

    it('skips storage I/O when storage is null', () => {
        const { result } = renderHook(() =>
            usePersistedState<string>('k', 'hi', null),
        )
        const [value, set, loaded] = result.current
        expect(value).toBe('hi')
        expect(loaded).toBe(true)
        act(() => set('updated'))
        expect(result.current[0]).toBe('updated')
    })

    it('skips storage I/O when key is empty', () => {
        const setItemSpy = vi.spyOn(localStorage, 'setItem')
        const { result } = renderHook(() =>
            usePersistedState<string>('', 'hi', localStorage),
        )
        act(() => result.current[1]('changed'))
        expect(setItemSpy).not.toHaveBeenCalled()
    })

    it('falls back to initial value when stored JSON is corrupt', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        localStorage.setItem('k', '{not-json')
        const { result } = renderHook(() =>
            usePersistedState<string>('k', 'fallback', localStorage),
        )
        expect(result.current[0]).toBe('fallback')
    })
})
