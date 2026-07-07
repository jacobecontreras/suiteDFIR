import { describe, it, expect } from 'vitest'
import {
    formatBytes,
    MAX_SPATIAL_FEATURES,
    MAX_SPATIAL_FILE_SIZE_BYTES,
    MAX_SPATIAL_IMPORT_FILES,
    MAX_SPATIAL_TOTAL_SIZE_BYTES,
} from './spatialLimits'

describe('formatBytes', () => {
    it('returns "0 B" for zero', () => {
        expect(formatBytes(0)).toBe('0 B')
    })

    it('returns "0 B" for negatives', () => {
        expect(formatBytes(-1)).toBe('0 B')
        expect(formatBytes(-1024)).toBe('0 B')
    })

    it('returns "0 B" for non-finite values', () => {
        expect(formatBytes(Number.NaN)).toBe('0 B')
        expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B')
    })

    it('formats bytes below 1 KB', () => {
        expect(formatBytes(512)).toBe('512 B')
        expect(formatBytes(1023)).toBe('1023 B')
    })

    it('rolls over to KB at exactly 1024 bytes', () => {
        expect(formatBytes(1024)).toBe('1 KB')
    })

    it('formats MB and GB', () => {
        expect(formatBytes(1024 * 1024)).toBe('1 MB')
        expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
    })

    it('rounds to one decimal place', () => {
        expect(formatBytes(1536)).toBe('1.5 KB')
        expect(formatBytes(1024 * 1024 * 2.25)).toBe('2.3 MB')
    })
})

describe('spatial limit constants', () => {
    it('keeps single-file limit smaller than the total budget', () => {
        expect(MAX_SPATIAL_FILE_SIZE_BYTES).toBeLessThan(MAX_SPATIAL_TOTAL_SIZE_BYTES)
    })

    it('exposes positive limits', () => {
        expect(MAX_SPATIAL_IMPORT_FILES).toBeGreaterThan(0)
        expect(MAX_SPATIAL_FEATURES).toBeGreaterThan(0)
    })
})
