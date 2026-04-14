import { useCallback } from 'react';

export interface BaseProcessingState {
    logs: string[];
    isRunning: boolean;
}

export interface UseProcessingStateOptions<TState extends BaseProcessingState> {
    state: TState;
    setState: (updater: (prev: TState) => TState) => void;
    maxLogs?: number;
}

export function useProcessingState<TState extends BaseProcessingState>(
    options: UseProcessingStateOptions<TState>
) {
    const { setState, maxLogs } = options;

    const appendLog = useCallback((message: string) => {
        setState(prev => {
            const nextLogs = maxLogs && prev.logs.length >= maxLogs
                ? [...prev.logs.slice(-(maxLogs - 1)), message]
                : [...prev.logs, message];
            return { ...prev, logs: nextLogs };
        });
    }, [setState, maxLogs]);

    const appendLogs = useCallback((messages: string[]) => {
        setState(prev => {
            let nextLogs = [...prev.logs, ...messages];
            if (maxLogs && nextLogs.length > maxLogs) {
                nextLogs = nextLogs.slice(-maxLogs);
            }
            return { ...prev, logs: nextLogs };
        });
    }, [setState, maxLogs]);

    const clearLogs = useCallback(() => {
        setState(prev => ({ ...prev, logs: [] }));
    }, [setState]);

    const setRunning = useCallback((value: boolean) => {
        setState(prev => ({ ...prev, isRunning: value }));
    }, [setState]);

    const patch = useCallback((updates: Partial<TState>) => {
        setState(prev => ({ ...prev, ...updates }));
    }, [setState]);

    const updateWith = useCallback((updater: (prev: TState) => TState) => {
        setState(updater);
    }, [setState]);

    return { appendLog, appendLogs, clearLogs, setRunning, patch, updateWith };
}
