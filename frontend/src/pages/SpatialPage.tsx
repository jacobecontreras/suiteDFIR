import { Suspense, lazy, useState, useCallback } from 'react'
import { LoadingPage } from '@/components/ui/LoadingPage'
import { GoogleMapsInfoModal } from '@/components/spatial/GoogleMapsInfoModal'
import { usePersistedState } from '@/hooks/usePersistedState'

const SpatialMap = lazy(() => import('@/components/spatial/SpatialMap'))

export default function SpatialPage() {
    const [pageContainer, setPageContainer] = useState<HTMLDivElement | null>(null)
    const [dismissed, setDismissed, isLoaded] = usePersistedState(
        'googleMapsInfoDismissed',
        false,
        typeof window !== 'undefined' ? window.localStorage : null
    )
    const [dismissedThisSession, setDismissedThisSession] = useState(false)
    const [dontShowAgain, setDontShowAgain] = useState(false)

    const handleModalOpenChange = useCallback((open: boolean) => {
        if (!open) {
            // User is closing the modal
            if (dontShowAgain) {
                setDismissed(true)
            }
            setDismissedThisSession(true)
        }
    }, [dontShowAgain, setDismissed])

    // Don't render modal until localStorage is loaded to prevent flash
    const shouldShowModal = isLoaded && !dismissed && !dismissedThisSession

    return (
        <div ref={setPageContainer} className="h-full w-full relative overflow-hidden">
            <Suspense fallback={<LoadingPage className="absolute inset-0 min-h-0 h-full z-10" />}>
                <SpatialMap />
            </Suspense>
            <GoogleMapsInfoModal
                open={shouldShowModal}
                onOpenChange={handleModalOpenChange}
                dontShowAgain={dontShowAgain}
                onDontShowAgainChange={setDontShowAgain}
                container={pageContainer}
            />
        </div>
    );
}
