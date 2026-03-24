import { useState, useEffect, useCallback } from 'react';

/**
 * Shared hook for selecting a library item and fetching its historical log.
 * Used by both LEAPP (reports) and Backup pages.
 *
 * @param isProcessing - Whether a job is currently running. Resets selection when true.
 * @param buildLogUrl  - Function that returns the full API URL for a given item id.
 * @param validItemIds - Optional list of valid item IDs. Clears selection if selectedId is no longer in this list.
 */
export function useHistoricalLogs(
    isProcessing: boolean,
    buildLogUrl: (id: number) => string,
    validItemIds?: number[]
) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [historicalLogs, setHistoricalLogs] = useState<string[]>([]);

    const handleItemClick = useCallback(async (id: number) => {
        // Toggle off if already selected
        if (selectedId === id) {
            clearSelection();
            return;
        }

        setSelectedId(id);
        try {
            const response = await fetch(buildLogUrl(id));
            if (response.ok) {
                const text = await response.text();
                setHistoricalLogs(text.split('\n').filter(line => line.length > 0));
            } else {
                setHistoricalLogs(['No log file found for this item.']);
            }
        } catch (error) {
            console.error('Failed to fetch historical logs:', error);
            setHistoricalLogs(['Error loading logs.']);
        }
    }, [selectedId, buildLogUrl]);

    const clearSelection = useCallback(() => {
        setSelectedId(null);
        setHistoricalLogs([]);
    }, []);

    // Reset selection when processing starts
    useEffect(() => {
        if (isProcessing) {
            clearSelection();
        }
    }, [isProcessing, clearSelection]);

    // Clear selection if the selected item is no longer in the valid item IDs list
    // This handles cases where items are deleted, removed by background refresh, or external changes
    useEffect(() => {
        if (selectedId !== null && validItemIds && !validItemIds.includes(selectedId)) {
            clearSelection();
        }
    }, [selectedId, validItemIds, clearSelection]);

    return { selectedId, historicalLogs, handleItemClick, clearSelection };
}
