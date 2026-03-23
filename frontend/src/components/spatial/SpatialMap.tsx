
import { useEffect, useState, useRef, useCallback } from "react"
import { MapContainer, TileLayer, useMap, GeoJSON, useMapEvents, Marker } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import MapControls from "./MapControls"
import type { Feature, GeoJsonObject } from 'geojson'
import { API } from "@/lib/api"
import { parseKmlText } from "@/lib/kmlUtils"
import { onEachFeature } from "@/lib/mapUtils"
import { useCase } from "@/context/CaseContext"
import { useSpatial } from "@/context/SpatialContext"
import { useToast } from "@/hooks/use-toast"
import { MAX_SPATIAL_FEATURES } from "@/lib/spatialLimits"

// Fix for default marker icons in Next.js
const iconUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png'
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png'
const shadowUrl = 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png'

const DefaultIcon = L.icon({
    iconUrl,
    iconRetinaUrl,
    shadowUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
    shadowSize: [41, 41]
})

L.Marker.prototype.options.icon = DefaultIcon

// Component to handle map flying for external updates (like search)
function MapUpdater({ center, zoom }: { center: [number, number], zoom: number }) {
    const map = useMap()
    useEffect(() => {
        const currentCenter = map.getCenter()
        const currentZoom = map.getZoom()

        // Only fly if coordinates are significantly different (prevents loop during manual pan)
        const latDiff = Math.abs(currentCenter.lat - center[0])
        const lngDiff = Math.abs(currentCenter.lng - center[1])
        const zoomDiff = Math.abs(currentZoom - zoom)

        if (latDiff > 0.001 || lngDiff > 0.001 || zoomDiff > 0.5) {
            map.flyTo(center, zoom, { duration: 1.5 })
        }
    }, [center, zoom, map])
    return null
}



// Component to track user movement and sync back to context
function ViewStateTracker({ onUpdate }: { onUpdate: (center: [number, number], zoom: number) => void }) {
    const map = useMapEvents({
        moveend: () => {
            const center = map.getCenter()
            onUpdate([center.lat, center.lng], map.getZoom())
        },
        zoomend: () => {
            const center = map.getCenter()
            onUpdate([center.lat, center.lng], map.getZoom())
        }
    })
    return null
}

// Component to handle container resize (e.g., when sidebar collapses)
function ResizeHandler() {
    const map = useMap()

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            // Delay to allow CSS transitions to complete
            setTimeout(() => {
                map.invalidateSize()
            }, 150)
        })

        const container = map.getContainer()
        if (container) {
            resizeObserver.observe(container)
        }

        return () => {
            resizeObserver.disconnect()
        }
    }, [map])

    return null
}

// Component to fit bounds to GeoJSON data
function AutoFitBounds({ data, path }: { data: GeoJsonObject | null, path?: string }) {
    const map = useMap()
    const { fittedPaths, markPathFitted } = useSpatial()
    const lastDataRef = useRef<GeoJsonObject | null>(null)

    useEffect(() => {
        if (data && data !== lastDataRef.current) {
            // If path provided, check if it's already been fitted in this session/state load
            if (path && fittedPaths.has(path)) {
                lastDataRef.current = data;
                return;
            }

            const geoJsonLayer = L.geoJSON(data)
            if (geoJsonLayer.getLayers().length > 0) {
                map.flyToBounds(geoJsonLayer.getBounds(), { padding: [50, 50], duration: 1.5 })
                if (path) markPathFitted(path);
            }
            lastDataRef.current = data
        }
    }, [data, map, path, fittedPaths, markPathFitted])
    return null
}

interface GoogleViewportState {
    zoom: number
    north: number
    south: number
    east: number
    west: number
}

function GoogleViewportReporter({ onChange }: { onChange: (viewport: GoogleViewportState) => void }) {
    const map = useMap()

    const reportViewport = useCallback(() => {
        const bounds = map.getBounds()
        onChange({
            zoom: map.getZoom(),
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest(),
        })
    }, [map, onChange])

    useEffect(() => {
        reportViewport()
    }, [reportViewport])

    useMapEvents({
        moveend: reportViewport,
        zoomend: reportViewport,
    })

    return null
}

function GoogleAttributionControl({ copyright }: { copyright: string | null }) {
    const map = useMap()

    useEffect(() => {
        const attributionControl = map.attributionControl
        if (!attributionControl || !copyright) {
            return
        }

        attributionControl.addAttribution(copyright)
        return () => {
            attributionControl.removeAttribution(copyright)
        }
    }, [copyright, map])

    return null
}



export default function SpatialMap() {
    const {
        center, setCenter,
        zoom, setZoom,
        layer, setLayer,
        tileSource, setTileSource,
        selectedKmlsPaths, setSelectedKmlsPaths,
        geoJsonData, geoJsonDataKey, setGeoJsonData,
        searchPin, setSearchPin,
        isStateLoaded
    } = useSpatial()

    const [browsedKmls, setBrowsedKmls] = useState<Record<string, GeoJsonObject>>({})
    const [hasGoogleApiKey, setHasGoogleApiKey] = useState<boolean>(false)
    const { selectedCaseId } = useCase()
    const { toast } = useToast()

    // Keep a ref to browsedKmls to avoid dependency cycle in the effect
    const browsedKmlsRef = useRef(browsedKmls);
    useEffect(() => {
        browsedKmlsRef.current = browsedKmls;
    }, [browsedKmls]);

    // Check if Google API key is configured
    useEffect(() => {
        const checkApiKey = async () => {
            try {
                const res = await fetch(API.path("/settings/google_maps_api_key"))
                setHasGoogleApiKey(res.ok && (await res.json()).value !== '')
            } catch {
                setHasGoogleApiKey(false)
            }
        }
        checkApiKey()
    }, [])

    // Callback to add KML data by URL (used by MapControls for temporary files)
    const addBrowsedKml = useCallback((url: string, data: GeoJsonObject) => {
        setBrowsedKmls(prev => ({
            ...prev,
            [url]: data
        }));
    }, []);

    // Callback to remove KML data by URL
    const removeBrowsedKml = useCallback((url: string) => {
        setBrowsedKmls(prev => {
            const next = { ...prev };
            delete next[url];
            return next;
        });
    }, []);

    // Fetch GeoJSON for selected KML paths (skip temp:// URLs - handled client-side)
    useEffect(() => {
        if (!isStateLoaded) return;

        const loadKmlData = async (path: string) => {
            // Skip temporary files - they're already parsed client-side in MapControls
            if (path.startsWith('temp://')) return;
            if (browsedKmlsRef.current[path]) return; // Already loaded

            try {
                const res = await fetch(API.path(`/spatial/kml-data?path=${encodeURIComponent(path)}`))
                if (res.ok) {
                    const text = await res.text()
                    const geojson = parseKmlText(text) as GeoJsonObject & { features: unknown[] }

                    if (Array.isArray(geojson.features) && geojson.features.length > MAX_SPATIAL_FEATURES) {
                        setSelectedKmlsPaths(prev => prev.filter(selectedPath => selectedPath !== path))
                        toast({
                            variant: "destructive",
                            title: "Spatial layer too large",
                            description: `This layer exceeds the safe limit of ${MAX_SPATIAL_FEATURES.toLocaleString()} features.`,
                        })
                        return
                    }

                    setBrowsedKmls(prev => ({
                        ...prev,
                        [path]: geojson
                    }))
                } else {
                    const errorData = await res.json().catch(() => null)
                    throw new Error(errorData?.detail || "Failed to load KML")
                }
            } catch (error) {
                console.error("Failed to load KML:", error)
                toast({
                    variant: "destructive",
                    title: "Spatial layer failed to load",
                    description: error instanceof Error ? error.message : "Failed to load the selected KML/KMZ file.",
                })
                setSelectedKmlsPaths(prev => prev.filter(selectedPath => selectedPath !== path))
            }
        }

        // Load new selections
        selectedKmlsPaths.forEach(path => loadKmlData(path));

        // Cleanup unselected data to save memory
        setBrowsedKmls(prev => {
            const next = { ...prev };
            let changed = false;
            Object.keys(next).forEach(path => {
                if (!selectedKmlsPaths.includes(path)) {
                    delete next[path];
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [selectedKmlsPaths, isStateLoaded]);

    const handleSearch = (lat: number, lon: number) => {
        setCenter([lat, lon])
        setZoom(16)
        setSearchPin([lat, lon])
    }

    const [tileSession, setTileSession] = useState<{
        session: string; key: string; mapType: string; expiry: number
    } | null>(null)
    const [lastFetchedLayer, setLastFetchedLayer] = useState<string | null>(null)
    const [googleViewport, setGoogleViewport] = useState<GoogleViewportState | null>(null)
    const [googleAttribution, setGoogleAttribution] = useState<string | null>(null)

    // Map app layer names to Google Maps Tile API session params
    const getSessionParams = useCallback((appLayer: string) => {
        switch (appLayer) {
            case 'satellite':
                return { mapType: 'satellite', language: 'en', region: 'US' }
            case 'hybrid':
                return { mapType: 'satellite', layerTypes: ['layerRoadmap'], overlay: false, language: 'en', region: 'US' }
            case 'normal':
            default:
                return { mapType: 'roadmap', language: 'en', region: 'US' }
        }
    }, [])

    // Fetch a tile session only when layer changes (backend handles caching)
    // Only fetch if tileSource is 'google'
    useEffect(() => {
        // Skip if not using Google tiles
        if (tileSource !== 'google') {
            return
        }

        // Skip if layer hasn't actually changed
        if (lastFetchedLayer === layer && tileSession) {
            return
        }

        let cancelled = false
        const fetchSession = async () => {
            try {
                const params = getSessionParams(layer)
                const res = await fetch(API.path('/spatial/tile-session'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(params),
                })
                if (res.ok && !cancelled) {
                    const data = await res.json()
                    setTileSession({
                        session: data.session,
                        key: data.key,
                        mapType: params.mapType,
                        expiry: data.expiry
                    })
                    setLastFetchedLayer(layer)
                } else if (res.status === 400 && !cancelled) {
                    // Google API key not configured - show toast
                    toast({
                        variant: "destructive",
                        title: "Google Maps API Key Required",
                        description: "Open the map settings panel to add a Google Maps API key and use Google layers.",
                    })
                    // Fall back to OSM
                    setTileSource('osm')
                }
            } catch (err) {
                console.error('Failed to fetch tile session:', err)
            }
        }
        fetchSession()
        return () => { cancelled = true }
    }, [layer, getSessionParams, lastFetchedLayer, tileSession, tileSource, setTileSource, toast])

    // Invalidate session on tile errors (for error recovery)
    const invalidateTileSession = useCallback(async () => {
        try {
            const params = getSessionParams(layer)
            await fetch(API.path('/spatial/tile-session'), {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            })
            // Force refetch on next render
            setLastFetchedLayer(null)
        } catch (err) {
            console.error('Failed to invalidate tile session:', err)
        }
    }, [layer, getSessionParams])

    useEffect(() => {
        if (tileSource !== 'google') {
            setGoogleAttribution(null)
            return
        }
        if (!tileSession || !googleViewport) {
            return
        }

        let cancelled = false
        const fetchAttribution = async () => {
            try {
                const params = getSessionParams(layer)
                const res = await fetch(API.path('/spatial/tile-attribution'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...params,
                        ...googleViewport,
                    }),
                })
                if (!res.ok) {
                    throw new Error('Tile attribution request failed')
                }

                const data = await res.json()
                if (!cancelled) {
                    setGoogleAttribution(data.copyright || null)
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to fetch Google tile attribution:', error)
                    setGoogleAttribution(null)
                }
            }
        }

        void fetchAttribution()
        return () => {
            cancelled = true
        }
    }, [getSessionParams, googleViewport, layer, tileSession, tileSource])

    const getTileLayers = () => {
        // OSM tiles (free, no API key required)
        if (tileSource === 'osm') {
            return (
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    maxZoom={19}
                />
            )
        }

        // Google tiles (require API key and session)
        if (!tileSession) return null

        const tileUrl = `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${tileSession.session}&key=${tileSession.key}`

        return (
            <TileLayer
                key={tileSession.session}
                attribution='<span translate="no">Google Maps</span>'
                url={tileUrl}
                maxZoom={22}
                eventHandlers={{
                    tileerror: (error) => {
                        // Check for session-related errors (400/403 typically indicate expired/invalid session)
                        if (error.tile && 'status' in error.tile) {
                            const status = (error.tile as { status?: number }).status
                            if (status === 400 || status === 403) {
                                console.warn('Tile session may be expired, invalidating cache')
                                invalidateTileSession()
                            }
                        }
                    }
                }}
            />
        )
    }



    return (
        <div className="relative h-full w-full bg-black">
            <MapControls
                onSearch={handleSearch}
                onLayerChange={setLayer}
                onTileSourceChange={(source, googleLayer) => {
                    if (source === 'google' && googleLayer) {
                        setLayer(googleLayer)
                    }
                }}
                onDataUpload={setGeoJsonData}
                onAddKmlData={addBrowsedKml}
                onRemoveKmlData={removeBrowsedKml}
                currentLayer={layer}
                currentTileSource={tileSource}
                selectedCaseId={selectedCaseId}
                hasGoogleApiKey={hasGoogleApiKey}
            />

            <MapContainer
                center={center}
                zoom={zoom}
                className="h-full w-full z-0"
                zoomControl={false}
                maxZoom={22}
            >
                <ResizeHandler />
                <ViewStateTracker onUpdate={(c, z) => {
                    setCenter(c)
                    setZoom(z)
                }} />
                <MapUpdater center={center} zoom={zoom} />
                <AutoFitBounds data={geoJsonData} />
                {tileSource === 'google' && (
                    <>
                        <GoogleViewportReporter onChange={setGoogleViewport} />
                        <GoogleAttributionControl copyright={googleAttribution} />
                    </>
                )}

                {searchPin && <Marker position={searchPin} />}

                {/* Auto-fit for browsed KMLs */}
                {Object.entries(browsedKmls).map(([url, data]) => (
                    <AutoFitBounds key={url} data={data} path={url} />
                ))}

                {getTileLayers()}

                {/* Uploaded Data */}
                {geoJsonData && (
                    <GeoJSON
                        key={geoJsonDataKey}
                        data={geoJsonData}
                        onEachFeature={onEachFeature}
                        style={() => ({
                            color: "#af52de", // Apple System Purple
                            weight: 3,
                            opacity: 0.8,
                            fillOpacity: 0.15
                        })}
                    />
                )}

                {/* Browsed KML Data */}
                {Object.entries(browsedKmls).map(([url, data]) => (
                    <GeoJSON
                        key={url}
                        data={data}
                        onEachFeature={onEachFeature}
                        style={() => ({
                            color: "#007aff", // Apple System Blue
                            weight: 3,
                            opacity: 0.8,
                            fillOpacity: 0.15
                        })}
                    />
                ))}
            </MapContainer>
        </div>
    )
}
