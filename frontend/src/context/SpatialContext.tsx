
import React, { createContext, useContext, useState, useEffect } from 'react'
import type { GeoJsonObject } from 'geojson'

type TileSource = 'osm' | 'google';
type GoogleLayer = 'normal' | 'satellite' | 'hybrid';

interface SpatialContextType {
    center: [number, number];
    zoom: number;
    layer: GoogleLayer;
    tileSource: TileSource;
    selectedKmlsPaths: string[];
    geoJsonData: GeoJsonObject | null;
    geoJsonDataKey: number;
    searchQuery: string;
    searchPin: [number, number] | null;

    setCenter: (center: [number, number] | ((prev: [number, number]) => [number, number])) => void;
    setZoom: (zoom: number | ((prev: number) => number)) => void;
    setLayer: (layer: GoogleLayer) => void;
    setTileSource: (source: TileSource) => void;
    setSelectedKmlsPaths: (paths: string[] | ((prev: string[]) => string[])) => void;
    setGeoJsonData: (data: GeoJsonObject | null) => void;
    setSearchQuery: (query: string | ((prev: string) => string)) => void;
    setSearchPin: (pin: [number, number] | null | ((prev: [number, number] | null) => [number, number] | null)) => void;

    // Tracking for auto-fitting
    fittedPaths: Set<string>;
    markPathFitted: (path: string) => void;

    // Trigger refresh of API key status across components
    refreshApiKey: () => void;
    apiKeyRefreshKey: number;

    isStateLoaded: boolean;
}

const SpatialContext = createContext<SpatialContextType | undefined>(undefined)

import { useCasePersistedState } from '@/hooks/useCasePersistedState';

const STORAGE_KEY_PREFIX = 'suitedfir_spatial_state_';

interface StoredState {
    center: [number, number];
    zoom: number;
    layer: GoogleLayer;
    tileSource: TileSource;
    selectedKmlsPaths: string[];
    searchQuery: string;
    searchPin: [number, number] | null;
}

const INITIAL_STATE: StoredState = {
    center: [40.7128, -74.0060],
    zoom: 13,
    layer: 'normal',
    tileSource: 'osm',
    selectedKmlsPaths: [],
    searchQuery: "",
    searchPin: null
};

export function SpatialProvider({ children }: { children: React.ReactNode }) {
    const [state, setState, isStateLoaded] = useCasePersistedState<StoredState>(
        STORAGE_KEY_PREFIX,
        INITIAL_STATE
    );

    const { center, zoom, layer, tileSource, selectedKmlsPaths, searchQuery, searchPin } = state;

    const setCenter = (val: [number, number] | ((prev: [number, number]) => [number, number])) =>
        setState(prev => ({ ...prev, center: typeof val === 'function' ? val(prev.center) : val }));
    const setZoom = (val: number | ((prev: number) => number)) =>
        setState(prev => ({ ...prev, zoom: typeof val === 'function' ? val(prev.zoom) : val }));
    const setLayer = (val: GoogleLayer) => setState(prev => ({ ...prev, layer: val }));
    const setTileSource = (val: TileSource) => setState(prev => ({ ...prev, tileSource: val }));
    const setSelectedKmlsPaths = (val: string[] | ((prev: string[]) => string[])) =>
        setState(prev => ({ ...prev, selectedKmlsPaths: typeof val === 'function' ? val(prev.selectedKmlsPaths) : val }));
    const setSearchQuery = (val: string | ((prev: string) => string)) =>
        setState(prev => ({ ...prev, searchQuery: typeof val === 'function' ? val(prev.searchQuery) : val }));
    const setSearchPin = (val: [number, number] | null | ((prev: [number, number] | null) => [number, number] | null)) =>
        setState(prev => ({ ...prev, searchPin: typeof val === 'function' ? val(prev.searchPin) : val }));

    const [geoJsonData, setGeoJsonDataState] = useState<GeoJsonObject | null>(null);
    const [geoJsonDataKey, setGeoJsonDataKey] = useState(0);
    const [fittedPaths, setFittedPaths] = useState<Set<string>>(new Set());
    const [apiKeyRefreshKey, setApiKeyRefreshKey] = useState(0);

    // Wrapper that increments key when data changes (for react-leaflet GeoJSON re-render)
    const setGeoJsonData = (data: GeoJsonObject | null) => {
        setGeoJsonDataState(data);
        setGeoJsonDataKey(prev => prev + 1);
    };

    const markPathFitted = (path: string) => {
        setFittedPaths(prev => new Set(prev).add(path));
    };

    const refreshApiKey = () => {
        setApiKeyRefreshKey(prev => prev + 1);
    };

    // Auto-sync fittedPaths with selectedKmlsPaths when state is loaded
    // Only remove paths from fittedPaths if they are no longer selected
    // Do NOT auto-add them; let SpatialMap handle that after flying to bounds
    useEffect(() => {
        if (isStateLoaded) {
            setFittedPaths(prev => {
                const next = new Set(prev);
                let changed = false;
                for (const path of next) {
                    if (!selectedKmlsPaths.includes(path)) {
                        next.delete(path);
                        changed = true;
                    }
                }
                return changed ? next : prev;
            });
        }
    }, [isStateLoaded, selectedKmlsPaths]);

    return (
        <SpatialContext.Provider value={{
            center,
            zoom,
            layer,
            tileSource,
            selectedKmlsPaths,
            geoJsonData,
            geoJsonDataKey,
            searchQuery,
            searchPin,
            setCenter,
            setZoom,
            setLayer,
            setTileSource,
            setSelectedKmlsPaths,
            setGeoJsonData,
            setSearchQuery,
            setSearchPin,
            fittedPaths,
            markPathFitted,
            refreshApiKey,
            apiKeyRefreshKey,
            isStateLoaded
        }}>
            {children}
        </SpatialContext.Provider>
    )
}

export function useSpatial() {
    const context = useContext(SpatialContext)
    if (context === undefined) {
        throw new Error('useSpatial must be used within a SpatialProvider')
    }
    return context
}
