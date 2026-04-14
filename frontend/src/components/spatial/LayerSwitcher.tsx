import { useState, useRef } from "react"
import { cn } from "@/lib/utils"
import { useSpatial } from "@/context/SpatialContext"
import { useToast } from "@/hooks/use-toast"
import { useClickOutside } from "@/hooks/useClickOutside"

interface LayerOption {
    id: 'osm' | 'google-normal' | 'google-satellite' | 'google-hybrid'
    label: string
    sublabel?: string
    image?: string
    requiresGoogleKey?: boolean
}

const LAYER_OPTIONS: LayerOption[] = [
    { id: 'osm', label: 'Default', sublabel: 'OSM', image: '/osm.webp' },
    { id: 'google-normal', label: 'Default', sublabel: 'Google', image: '/default.webp', requiresGoogleKey: true },
    { id: 'google-satellite', label: 'Satellite', sublabel: 'Google', image: '/satellite.webp', requiresGoogleKey: true },
    { id: 'google-hybrid', label: 'Hybrid', sublabel: 'Google', image: '/hybrid.webp', requiresGoogleKey: true },
]

const LayerPreview = ({ type, size = 'sm' }: { type: LayerOption['id'], size?: 'sm' | 'lg' }) => {
    const option = LAYER_OPTIONS.find(o => o.id === type)
    const dims = size === 'lg' ? { w: 60, h: 52 } : { w: 48, h: 42 }

    return (
        <img
            src={option?.image}
            alt={option?.label}
            width={dims.w}
            height={dims.h}
            className="w-full h-full object-cover"
            draggable={false}
        />
    )
}

interface LayerSwitcherProps {
    currentLayer: 'normal' | 'satellite' | 'hybrid'
    currentTileSource: 'osm' | 'google'
    hasGoogleApiKey: boolean
}

export default function LayerSwitcher({ currentLayer, currentTileSource, hasGoogleApiKey }: LayerSwitcherProps) {
    const { setTileSource, setLayer } = useSpatial()
    const { toast } = useToast()
    const [showLayerMenu, setShowLayerMenu] = useState(false)
    const layerMenuRef = useRef<HTMLDivElement>(null)

    useClickOutside(
        [layerMenuRef],
        () => setShowLayerMenu(false),
        { enabled: showLayerMenu }
    )

    return (
        <div ref={layerMenuRef} className="absolute bottom-6 left-4 z-[1000] pointer-events-auto">
            <div className="flex items-center gap-3">
                {/* Current Layer Preview (Primary Toggle) */}
                <button
                    onClick={() => setShowLayerMenu(!showLayerMenu)}
                    className="bg-[#1A1A1A]/90 border border-[#333] rounded-lg p-1.5 shadow-xl transition-all duration-200 hover:shadow-2xl"
                >
                    <div className="rounded-md overflow-hidden" style={{ width: 52, height: 46 }}>
                        <LayerPreview type={currentTileSource === 'osm' ? 'osm' : `google-${currentLayer}` as LayerOption['id']} size="lg" />
                    </div>
                    <div className="text-center mt-1">
                        <span className="block text-[9px] font-medium text-white">
                            {currentTileSource === 'osm' ? 'Default' : LAYER_OPTIONS.find(l => l.id === `google-${currentLayer}`)?.label}
                        </span>
                        <span className="block text-[7px] text-gray-400">
                            {currentTileSource === 'osm' ? 'OSM' : LAYER_OPTIONS.find(l => l.id === `google-${currentLayer}`)?.sublabel}
                        </span>
                    </div>
                </button>

                {/* Expanded Layer Options (Ribbon) */}
                <div className={cn(
                    "transition-all duration-200 overflow-hidden",
                    showLayerMenu ? "opacity-100 max-w-[250px]" : "opacity-0 max-w-0"
                )}>
                    <div className="bg-[#1A1A1A]/90 border border-[#333] rounded-lg p-1.5 shadow-xl">
                        <div className="flex items-center gap-2">
                            {LAYER_OPTIONS.map((option) => {
                                const isGoogleLayer = option.requiresGoogleKey
                                const isDisabled = isGoogleLayer && !hasGoogleApiKey

                                return (
                                    <button
                                        key={option.id}
                                        onClick={() => {
                                            if (isDisabled) {
                                                toast({
                                                    variant: "destructive",
                                                    title: "Google Maps API Key Required",
                                                    description: "Open the map settings panel to add a Google Maps API key and use Google layers.",
                                                })
                                                return
                                            }

                                            if (option.id === 'osm') {
                                                setTileSource('osm')
                                            } else {
                                                setTileSource('google')
                                                const googleLayer = option.id.replace('google-', '') as 'normal' | 'satellite' | 'hybrid'
                                                setLayer(googleLayer)
                                            }
                                            setShowLayerMenu(false)
                                        }}
                                        disabled={isDisabled}
                                        className={cn(
                                            "transition-all duration-150 relative",
                                            !isDisabled && "hover:scale-105",
                                            isDisabled && "opacity-50 cursor-not-allowed"
                                        )}
                                        title={isDisabled ? "Requires Google Maps API key" : option.label}
                                    >
                                        <div className="rounded-md overflow-hidden shadow-md" style={{ width: 50, height: 44 }}>
                                            <LayerPreview type={option.id} size="sm" />
                                        </div>
                                        <div className="text-center mt-1">
                                            <span className="block text-[8px] font-medium text-white">{option.label}</span>
                                            {option.sublabel && (
                                                <span className="block text-[7px] text-gray-400">{option.sublabel}</span>
                                            )}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
