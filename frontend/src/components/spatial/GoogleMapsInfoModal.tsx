import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Dialog'
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
    container
}: GoogleMapsInfoModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                portalContainer={container}
                overlayClassName={container ? "absolute inset-0" : undefined}
                className={container ? "absolute max-w-[300px] p-4 bg-[#1A1A1A] border-[#333333]" : "max-w-[300px] p-4 bg-[#1A1A1A] border-[#333333]"}
            >
                <DialogTitle className="sr-only">Google Maps Features</DialogTitle>
                <DialogDescription className="text-[11px] text-gray-400 leading-relaxed space-y-2">
                    <p>
                        <span className="text-gray-300">OSM tiles + Nominatim geocoding</span> are free by default.
                    </p>
                    <p>
                        Google Maps tiles & search autocomplete <span className="text-gray-300">require an API key</span> (set in map settings).
                    </p>
                </DialogDescription>

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
            </DialogContent>
        </Dialog>
    )
}
