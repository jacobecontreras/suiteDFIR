
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import type { PaginationState, SortingState, ColumnFiltersState } from '@tanstack/react-table'
import type { MRT_DensityState } from '@/components/ui/DataTable'

interface TimelineConfig {
    selectedReportId: number | 'all';
    selectedTimezone: string;
    pagination: PaginationState;
    sorting: SortingState;
    globalFilter: string;
    columnFilters: ColumnFiltersState;
    density: MRT_DensityState;
    scrollPosition: number;
    selectedEventId: number | null;
}

interface TimelineState {
    config: TimelineConfig;
    isLoaded: boolean;
}

interface TimelineContextType extends TimelineState {
    updateConfig: (updates: Partial<TimelineConfig>) => void;
}

const TimelineContext = createContext<TimelineContextType | undefined>(undefined);

import { useCasePersistedState } from '@/hooks/useCasePersistedState';

const STORAGE_KEY_PREFIX = 'suitedfir_timeline_state_v2_';

const INITIAL_CONFIG: TimelineConfig = {
    selectedReportId: 'all',
    selectedTimezone: 'UTC',
    pagination: { pageIndex: 0, pageSize: 50 },
    sorting: [{ id: 'date', desc: true }],
    globalFilter: '',
    columnFilters: [],
    density: 'compact',
    scrollPosition: 0,
    selectedEventId: null,
};

export function TimelineProvider({ children }: { children: ReactNode }) {
    const [config, setConfig, isLoaded] = useCasePersistedState<TimelineConfig>(
        STORAGE_KEY_PREFIX,
        INITIAL_CONFIG
    );

    const updateConfig = useCallback((updates: Partial<TimelineConfig>) => {
        setConfig(prev => ({ ...prev, ...updates }));
    }, [setConfig]);

    return (
        <TimelineContext.Provider value={{
            config,
            isLoaded,
            updateConfig
        }}>
            {children}
        </TimelineContext.Provider>
    );
}

export function useTimeline() {
    const context = useContext(TimelineContext);
    if (context === undefined) {
        throw new Error('useTimeline must be used within a TimelineProvider');
    }
    return context;
}
