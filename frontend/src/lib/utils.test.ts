import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
    it('joins simple class strings', () => {
        expect(cn('a', 'b')).toBe('a b')
    })

    it('drops falsy values', () => {
        expect(cn('a', false, null, undefined, 'b')).toBe('a b')
    })

    it('honors conditional object syntax from clsx', () => {
        expect(cn('a', { b: true, c: false })).toBe('a b')
    })

    it('merges conflicting tailwind classes (last wins)', () => {
        expect(cn('p-2', 'p-4')).toBe('p-4')
    })

    it('preserves non-conflicting tailwind classes', () => {
        expect(cn('p-2', 'm-2')).toBe('p-2 m-2')
    })
})
