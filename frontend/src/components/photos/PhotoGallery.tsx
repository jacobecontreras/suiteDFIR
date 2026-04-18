import { usePhotos } from '@/context/PhotosContext'
import { GalleryToolbar } from './GalleryToolbar'
import { PhotoGrid } from './PhotoGrid'

export function PhotoGallery() {
    const {
        photos,
        totalPhotos,
        searchResults,
        isLoadingPhotos,
        loadMorePhotos,
    } = usePhotos()

    // Use search results if available, otherwise use paginated photos
    const displayItems = searchResults ?? photos

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Toolbar: extraction selector, search, filters, sort */}
            <GalleryToolbar />

            {/* Photo grid */}
            <PhotoGrid
                items={displayItems}
                isLoading={isLoadingPhotos}
                hasMore={!searchResults && photos.length < totalPhotos}
                onLoadMore={loadMorePhotos}
            />
        </div>
    )
}
