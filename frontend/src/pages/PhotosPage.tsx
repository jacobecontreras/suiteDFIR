import { Image } from 'lucide-react'
import { usePhotos } from '@/context/PhotosContext'
import { PhotoGallery } from '@/components/photos/PhotoGallery'

export default function PhotosPage() {
    const { selectedExtraction, extractions } = usePhotos()

    // Show gallery if an extraction is selected (or will be once extractions load)
    if (selectedExtraction) {
        return <PhotoGallery />
    }

    // Extractions loaded but none are completed — show empty state
    const hasCompleted = extractions.some(e => e.status === 'completed' && e.image_count > 0)
    if (extractions.length > 0 && !hasCompleted) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Image className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">No Extractions Found</p>
            </div>
        )
    }

    // Still loading extractions, or auto-select hasn't fired yet — show nothing briefly
    if (extractions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Image className="h-10 w-10 mb-3 opacity-30" />
                <p className="text-sm">No Extractions Found</p>
            </div>
        )
    }

    // Completed extractions exist but none selected yet (auto-select pending)
    return <PhotoGallery />
}
