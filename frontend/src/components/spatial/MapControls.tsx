import { useState } from "react"
import SearchBar from "./SearchBar"
import ImportPanel from "./ImportPanel"
import KmlBrowser, { type KmlFile } from "./KmlBrowser"
import LayerSwitcher from "./LayerSwitcher"
import SpatialSettingsPanel from "./SpatialSettingsPanel"
import type { GeoJsonObject } from 'geojson'

interface MapControlsProps {
    onSearch: (lat: number, lon: number) => void
    onAddKmlData: (url: string, data: GeoJsonObject) => void
    onRemoveKmlData: (url: string) => void
    currentLayer: 'normal' | 'satellite' | 'hybrid'
    currentTileSource: 'osm' | 'google'
    selectedCaseId: string | null
    hasGoogleApiKey: boolean
}

export default function MapControls({
    onSearch,
    onAddKmlData,
    onRemoveKmlData,
    currentLayer,
    currentTileSource,
    selectedCaseId,
    hasGoogleApiKey,
}: MapControlsProps) {
    // Shared state for ImportPanel → KmlBrowser communication
    const [showKmlMenu, setShowKmlMenu] = useState(false)
    const [temporaryKmls, setTemporaryKmls] = useState<KmlFile[]>([])
    const [kmlRefreshKey, setKmlRefreshKey] = useState(0)

    return (
        <>
            {/* Top Controls */}
            <div className="absolute top-4 left-4 right-4 z-[1000] flex justify-between items-start pointer-events-none">
                <SearchBar onSearch={onSearch} currentTileSource={currentTileSource} />

                <div className="flex gap-2 pointer-events-auto">
                    <ImportPanel
                        selectedCaseId={selectedCaseId}
                        onImportComplete={(files) => {
                            setTemporaryKmls(prev => [...prev, ...files])
                            setShowKmlMenu(true)
                        }}
                        onSaveComplete={() => {
                            setShowKmlMenu(true)
                            setKmlRefreshKey(k => k + 1)
                        }}
                    />
                    <KmlBrowser
                        isOpen={showKmlMenu}
                        onOpenChange={setShowKmlMenu}
                        temporaryKmls={temporaryKmls}
                        onTemporaryKmlsChange={setTemporaryKmls}
                        onAddKmlData={onAddKmlData}
                        onRemoveKmlData={onRemoveKmlData}
                        selectedCaseId={selectedCaseId}
                        refreshKey={kmlRefreshKey}
                    />
                    <SpatialSettingsPanel />
                </div>
            </div>

            {/* Bottom Left - Layer Switcher */}
            <LayerSwitcher
                currentLayer={currentLayer}
                currentTileSource={currentTileSource}
                hasGoogleApiKey={hasGoogleApiKey}
            />
        </>
    )
}
