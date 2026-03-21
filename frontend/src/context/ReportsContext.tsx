
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'

interface ReportViewState {
    scrollPosition: number;
    timestamp: number;
}

// DataTable state for each artifact page
export interface DataTableState {
    pageLength: number;  // "Show X entries" dropdown value (10, 25, 50, 100)
    pageNum: number;     // Current pagination page (0-based index)
    searchText: string;  // Search bar text content
}

// Enhanced iframe state for session-based tracking (not persisted to localStorage)
export interface ReportIframeState {
    mainScrollY: number;
    sidebarScrollY: number;
    currentPage: string;  // Current artifact page within the report
    dtStates?: Record<string, DataTableState>;  // Per-artifact DataTable states (URL -> state)
    activeTab?: string;   // Current active tab ID (optional)
}

interface ReportsContextType {
    // Current UI state (persisted to localStorage)
    selectedReportId: number | null;
    filter: 'all' | 'ileapp' | 'aleapp';
    sort: 'newest' | 'oldest' | 'name';
    searchQuery: string;

    // Actions for UI state
    setSelectedReportId: (id: number | null) => void;
    setFilter: (filter: 'all' | 'ileapp' | 'aleapp') => void;
    setSort: (sort: 'newest' | 'oldest' | 'name') => void;
    setSearchQuery: (query: string) => void;

    // Legacy scroll position management (localStorage)
    saveReportScrollPosition: (reportId: number, scrollY: number) => void;
    getReportScrollPosition: (reportId: number) => number;

    // Enhanced iframe state management (session-only)
    saveReportIframeState: (reportId: number, state: ReportIframeState) => void;
    getReportIframeState: (reportId: number) => ReportIframeState | null;

    // Initialization state
    isStateLoaded: boolean;
}

import { useCase } from './CaseContext';

const ReportsContext = createContext<ReportsContextType | undefined>(undefined)

import { useCasePersistedState } from '@/hooks/useCasePersistedState';

const STORAGE_KEY_PREFIX = 'suitedfir_reports_state_v2_';

interface StoredState {
    selectedReportId: number | null;
    filter: 'all' | 'ileapp' | 'aleapp';
    sort: 'newest' | 'oldest' | 'name';
    searchQuery: string;
    reportViewStates: Record<number, ReportViewState>;
    iframeStates: Record<number, ReportIframeState>;
}

const INITIAL_STATE: StoredState = {
    selectedReportId: null,
    filter: 'all',
    sort: 'newest',
    searchQuery: '',
    reportViewStates: {},
    iframeStates: {}
};

export function ReportsProvider({ children }: { children: React.ReactNode }) {
    const [state, setState, isStateLoaded] = useCasePersistedState<StoredState>(
        STORAGE_KEY_PREFIX,
        INITIAL_STATE
    );

    const { selectedReportId, filter, sort, searchQuery, reportViewStates, iframeStates } = state;

    const setSelectedReportId = (val: number | null) => setState(prev => ({ ...prev, selectedReportId: val }));
    const setFilter = (val: 'all' | 'ileapp' | 'aleapp') => setState(prev => ({ ...prev, filter: val }));
    const setSort = (val: 'newest' | 'oldest' | 'name') => setState(prev => ({ ...prev, sort: val }));
    const setSearchQuery = (val: string) => setState(prev => ({ ...prev, searchQuery: val }));

    const saveReportScrollPosition = useCallback((reportId: number, scrollY: number) => {
        setState(prev => ({
            ...prev,
            reportViewStates: {
                ...prev.reportViewStates,
                [reportId]: {
                    scrollPosition: scrollY,
                    timestamp: Date.now()
                }
            }
        }));
    }, [setState]);

    const getReportScrollPosition = useCallback((reportId: number): number => {
        return reportViewStates[reportId]?.scrollPosition ?? 0;
    }, [reportViewStates]);

    // Session-only enhanced iframe state (using Ref for performance, but persisting periodically)
    const iframeStatesRef = useRef<Record<number, ReportIframeState>>({});

    // Sync Ref with state on load
    useEffect(() => {
        if (isStateLoaded) {
            iframeStatesRef.current = iframeStates;
        }
    }, [isStateLoaded, iframeStates]);

    const saveReportIframeState = useCallback((reportId: number, stateVal: ReportIframeState) => {
        iframeStatesRef.current[reportId] = stateVal;

        // Persist the whole Record to state (and thus to storage)
        setState(prev => ({
            ...prev,
            iframeStates: { ...iframeStatesRef.current }
        }));
    }, [setState]);

    const getReportIframeState = useCallback((reportId: number) => {
        return iframeStatesRef.current[reportId] ?? null;
    }, []);

    return (
        <ReportsContext.Provider value={{
            selectedReportId,
            filter,
            sort,
            searchQuery,
            isStateLoaded,
            setSelectedReportId,
            setFilter,
            setSort,
            setSearchQuery,
            saveReportScrollPosition,
            getReportScrollPosition,
            saveReportIframeState,
            getReportIframeState
        }}>
            {children}
        </ReportsContext.Provider>
    )
}

export function useReports() {
    const context = useContext(ReportsContext)
    if (context === undefined) {
        throw new Error('useReports must be used within a ReportsProvider')
    }
    return context
}
