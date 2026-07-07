import { describe, expect, it } from 'vitest'
import { getUniqueName } from './naming'

describe('getUniqueName', () => {
    it('returns the original name when it is unique', () => {
        expect(getUniqueName('Report', ['Other'])).toBe('Report')
    })

    it('appends " (1)" on first collision', () => {
        expect(getUniqueName('Report', ['Report'])).toBe('Report (1)')
    })

    it('skips over taken numbered names', () => {
        expect(getUniqueName('Report', ['Report', 'Report (1)', 'Report (2)'])).toBe('Report (3)')
    })

    it('increments past an existing numbered name', () => {
        expect(getUniqueName('Report (3)', ['Report (3)'])).toBe('Report (4)')
    })

    it('treats numbered name like new base when free', () => {
        expect(getUniqueName('Report (5)', ['Other'])).toBe('Report (5)')
    })

    it('handles empty existingNames', () => {
        expect(getUniqueName('Report', [])).toBe('Report')
    })

    it('keeps trailing parens-not-number untouched', () => {
        expect(getUniqueName('Report (final)', ['Report (final)'])).toBe('Report (final) (1)')
    })
})
