import { Suspense, lazy } from 'react'
import { LoadingPage } from '@/components/ui/LoadingPage'

const SpatialMap = lazy(() => import('@/components/spatial/SpatialMap'))

export default function SpatialPage() {
    return (
        <div className="h-full w-full relative overflow-hidden">
            <Suspense fallback={<LoadingPage />}>
                <SpatialMap />
            </Suspense>
        </div>
    );
}
