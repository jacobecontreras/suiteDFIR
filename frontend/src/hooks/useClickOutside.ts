import { useEffect, type RefObject } from 'react'

/**
 * Calls `onClickOutside` when a mousedown lands outside all provided refs.
 * Optionally closes on Escape key as well.
 *
 * @param refs       - DOM element refs that are considered "inside"
 * @param onClickOutside - fired on outside click or Escape
 * @param options.enabled - skip listeners when false (default true)
 * @param options.onEscape - custom Escape handler; if omitted, Escape calls onClickOutside
 */
export function useClickOutside(
    refs: RefObject<HTMLElement | null>[],
    onClickOutside: () => void,
    options: {
        enabled?: boolean
        onEscape?: () => void
        suppressClickWhen?: () => boolean
    } = {}
) {
    const { enabled = true, onEscape, suppressClickWhen } = options

    useEffect(() => {
        if (!enabled) return

        const handleClick = (event: MouseEvent) => {
            if (suppressClickWhen?.()) return

            const target = event.target as Node
            const isInside = refs.some(ref => ref.current?.contains(target))
            if (!isInside) {
                onClickOutside()
            }
        }

        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                if (onEscape) {
                    onEscape()
                } else {
                    onClickOutside()
                }
            }
        }

        document.addEventListener('mousedown', handleClick)
        document.addEventListener('keydown', handleKeydown)

        return () => {
            document.removeEventListener('mousedown', handleClick)
            document.removeEventListener('keydown', handleKeydown)
        }
    }, [refs, onClickOutside, enabled, onEscape, suppressClickWhen])
}
