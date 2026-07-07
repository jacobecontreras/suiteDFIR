import { describe, expect, it } from 'vitest'
import { generateProgressBar } from './progress'

describe('generateProgressBar', () => {
    it('renders a bar at 0% with at least one filled char', () => {
        const bar = generateProgressBar(0, 10)
        expect(bar).toBe('[#         ]   0%')
    })

    it('renders a fully filled bar at 100%', () => {
        const bar = generateProgressBar(100, 10)
        expect(bar).toBe('[##########] 100%')
    })

    it('rounds fractional percentages', () => {
        const bar = generateProgressBar(33.4, 10)
        expect(bar).toContain('33%')
    })

    it('clamps values above 100', () => {
        expect(generateProgressBar(150, 5)).toBe('[#####] 100%')
    })

    it('clamps negative values to 0', () => {
        expect(generateProgressBar(-25, 5)).toBe('[#    ]   0%')
    })

    it('pads percentage to width 3', () => {
        // Format is `] ` + percent padded to 3 chars + `%`.
        expect(generateProgressBar(7, 4)).toMatch(/]\s{3}7%$/)
        expect(generateProgressBar(70, 4)).toMatch(/]\s{2}70%$/)
        expect(generateProgressBar(100, 4)).toMatch(/]\s100%$/)
    })

    it('defaults length to 20', () => {
        const bar = generateProgressBar(50)
        const inside = bar.slice(1, bar.indexOf(']'))
        expect(inside).toHaveLength(20)
    })
})
