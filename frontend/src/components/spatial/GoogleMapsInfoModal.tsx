import { Checkbox } from '@/components/ui/Checkbox'
import { Button } from '@/components/ui/Button'

interface GoogleMapsInfoModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    dontShowAgain: boolean
    onDontShowAgainChange: (checked: boolean) => void
    container?: HTMLElement | null
}

export function GoogleMapsInfoModal({
    open,
    onOpenChange,
    dontShowAgain,
    onDontShowAgainChange,
}: GoogleMapsInfoModalProps) {
    if (!open) return null

    return (
        <>
            {/* Overlay - scoped to the page container */}
            <div
                className="absolute inset-0 z-[1001] bg-black/80 animate-in fade-in-0 duration-200"
                onClick={() => onOpenChange(false)}
            />

            {/* Content */}
            <div className="absolute left-1/2 top-1/2 z-[1002] -translate-x-1/2 -translate-y-1/2 max-w-[300px] p-4 bg-[#1A1A1A] border border-[#333333] rounded-lg shadow-lg animate-in fade-in-0 duration-200">
                <p className="text-[11px] text-gray-400 leading-relaxed">
                    <span className="text-gray-300">OSM tiles + Nominatim geocoding</span> are free by default.
                </p>
                <p className="text-[11px] text-gray-400 leading-relaxed mt-2">
                    Google Maps tiles & geocoding <span className="text-gray-300">require an API key</span> (set in map settings).
                </p>

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#2A2A2A]">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                            checked={dontShowAgain}
                            onCheckedChange={onDontShowAgainChange}
                            aria-label="Don't show this again"
                        />
                        <span className="text-[11px] text-gray-400">Don't show again</span>
                    </label>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="h-7 text-[11px] bg-[#333333] hover:bg-[#404040] text-white border border-white/10"
                        onClick={() => onOpenChange(false)}
                    >
                        Got it
                    </Button>
                </div>
            </div>
        </>
    )
}
