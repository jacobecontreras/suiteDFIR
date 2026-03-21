
import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode, useMemo } from 'react'
import { useCase } from './CaseContext';
import { createLeappApi } from '../services/leappApi'
import { Module } from '@/types/leapp';

interface ProcessingState {
    logs: string[];
    isProcessing: boolean;
    progress: { current: number; total: number };
    taskId: string | null;
    processingReportName: string | null;
    encryptionDetected: boolean;
    passwordProvided: boolean;
}

interface ToolConfig {
    inputFile: string;
    reportName: string;
    selectedModules: string[] | null;
    artifactScrollPos: number;
    logScrollPos: Record<string, number>;
}

interface ToolState {
    config: ToolConfig;
    processing: ProcessingState;
    modules: Module[];
    isLoadingModules: boolean;
}

interface LeappContextType {
    states: {
        ileapp: ToolState;
        aleapp: ToolState;
    };
    updateConfig: (tool: string, updates: Partial<ToolConfig>) => void;
    fetchModules: (tool: string) => Promise<void>;
    toggleModule: (tool: string, name: string, selected: boolean) => Promise<void>;
    selectAll: (tool: string) => Promise<void>;
    selectNone: (tool: string) => Promise<void>;
    startProcessing: (tool: string, inputFile: string, outputFolder: string, reportName?: string, password?: string, caseId?: number) => Promise<void>;
    stopProcessing: (tool: string) => Promise<void>;
    clearLogs: (tool: string) => void;
    clearProcessingReportName: (tool: string) => void;
}

const LeappContext = createContext<LeappContextType | undefined>(undefined)

import { useCasePersistedState } from '@/hooks/useCasePersistedState';

const STORAGE_KEY_PREFIX = 'suitedfir_leapp_configs_';
const MAX_LOGS = 2000;

const INITIAL_PROCESSING: ProcessingState = {
    logs: [],
    isProcessing: false,
    progress: { current: 0, total: 0 },
    taskId: null,
    processingReportName: null,
    encryptionDetected: false,
    passwordProvided: false
};

const INITIAL_CONFIG: ToolConfig = {
    inputFile: '',
    reportName: '',
    selectedModules: null,
    artifactScrollPos: 0,
    logScrollPos: {}
};

interface LeappPersistedState {
    ileapp: { config: ToolConfig; processing: ProcessingState };
    aleapp: { config: ToolConfig; processing: ProcessingState };
}

const INITIAL_STATE: LeappPersistedState = {
    ileapp: { config: { ...INITIAL_CONFIG }, processing: { ...INITIAL_PROCESSING } },
    aleapp: { config: { ...INITIAL_CONFIG }, processing: { ...INITIAL_PROCESSING } }
};

export function LeappProvider({ children }: { children: ReactNode }) {
    const [persistedStates, setPersistedStates, isLoaded] = useCasePersistedState<LeappPersistedState>(
        STORAGE_KEY_PREFIX,
        INITIAL_STATE
    );

    // Feature-local state (non-persisted)
    const [transientStates, setTransientStates] = useState<Record<string, { modules: Module[]; isLoadingModules: boolean }>>({
        ileapp: { modules: [], isLoadingModules: false },
        aleapp: { modules: [], isLoadingModules: false }
    });

    // Derived states
    const states = useMemo(() => ({
        ileapp: { ...persistedStates.ileapp, ...transientStates.ileapp },
        aleapp: { ...persistedStates.aleapp, ...transientStates.aleapp }
    }), [persistedStates, transientStates]);

    const [readyToReconnect, setReadyToReconnect] = useState<string | null>(null);
    const eventSourceRefs = useRef<Record<string, EventSource>>({});
    const statesRef = useRef(states);

    const { selectedCaseId } = useCase();

    // Keep statesRef in sync
    useEffect(() => { statesRef.current = states; }, [states]);

    // Cleanup EventSources on unmount
    useEffect(() => {
        return () => {
            Object.values(eventSourceRefs.current).forEach(es => es.close());
        };
    }, []);

    // Signal ready for reconnection after state has been updated
    useEffect(() => {
        if (isLoaded && selectedCaseId) {
            setReadyToReconnect(selectedCaseId);
        }
    }, [isLoaded, selectedCaseId, persistedStates.ileapp.processing.taskId, persistedStates.aleapp.processing.taskId]);

    const updateConfig = useCallback((tool: string, updates: Partial<ToolConfig>) => {
        setPersistedStates(prev => {
            const toolKey = tool as keyof LeappPersistedState;
            return {
                ...prev,
                [tool]: {
                    ...prev[toolKey],
                    config: { ...prev[toolKey].config, ...updates }
                }
            };
        });
    }, [setPersistedStates]);

    const updateProcessing = useCallback((tool: string, updates: Partial<ProcessingState>) => {
        setPersistedStates(prev => {
            const toolKey = tool as keyof LeappPersistedState;
            return {
                ...prev,
                [tool]: {
                    ...prev[toolKey],
                    processing: { ...prev[toolKey].processing, ...updates }
                }
            };
        });
    }, [setPersistedStates]);

    const fetchModules = useCallback(async (tool: string) => {
        // Prevent redundant fetches
        let alreadyLoading = false;
        setTransientStates(prev => {
            if (prev[tool].isLoadingModules || prev[tool].modules.length > 0) {
                alreadyLoading = true;
                return prev;
            }
            return { ...prev, [tool]: { ...prev[tool], isLoadingModules: true } };
        });

        if (alreadyLoading) return;

        try {
            const api = createLeappApi(tool);
            const data = await api.modules.getAll();
            const selectedModuleNames = data.modules.filter(m => m.selected).map(m => m.name);

            setTransientStates(prev => ({
                ...prev,
                [tool]: {
                    ...prev[tool],
                    modules: data.modules,
                    isLoadingModules: false
                }
            }));

            // Also update persisted selections if necessary
            setPersistedStates(prev => {
                const currentSelection = prev[tool as keyof LeappPersistedState].config.selectedModules;
                const serverSelected = selectedModuleNames;

                // Merge policy: if we have local selections (even an empty list), prefer them.
                // Otherwise use server defaults.
                const finalSelected = currentSelection !== null
                    ? currentSelection
                    : serverSelected;

                return {
                    ...prev,
                    [tool]: {
                        ...prev[tool as keyof LeappPersistedState],
                        config: { ...prev[tool as keyof LeappPersistedState].config, selectedModules: finalSelected }
                    }
                };
            });
        } catch (error) {
            console.error(`Failed to load modules for ${tool}:`, error);
            setTransientStates(prev => ({ ...prev, [tool]: { ...prev[tool], isLoadingModules: false } }));
        }
    }, [setPersistedStates]);

    const toggleModule = useCallback(async (tool: string, name: string, selected: boolean) => {
        setPersistedStates(prev => {
            const toolKey = tool as keyof LeappPersistedState;
            const currentSelected = new Set(prev[toolKey].config.selectedModules);
            if (selected) currentSelected.add(name);
            else currentSelected.delete(name);

            return {
                ...prev,
                [tool]: {
                    ...prev[toolKey],
                    config: { ...prev[toolKey].config, selectedModules: Array.from(currentSelected) }
                }
            };
        });

        const api = createLeappApi(tool);
        try {
            await api.modules.select({ [name]: selected });
        } catch (error) {
            console.error(`Failed to update module ${name} for ${tool}:`, error);
        }
    }, [setPersistedStates]);

    const selectAll = useCallback(async (tool: string) => {
        const toolKey = tool as keyof LeappPersistedState;
        const toolState = statesRef.current[toolKey];
        const allModuleNames = toolState.modules.map((m: Module) => m.name);

        updateConfig(tool, { selectedModules: allModuleNames });

        const api = createLeappApi(tool);
        const selectionUpdates: Record<string, boolean> = {};
        allModuleNames.forEach(name => selectionUpdates[name] = true);

        try {
            await api.modules.select(selectionUpdates);
        } catch (error) {
            console.error(`Failed to select all modules for ${tool}:`, error);
        }
    }, [updateConfig]);

    const selectNone = useCallback(async (tool: string) => {
        const toolKey = tool as keyof LeappPersistedState;
        const toolState = statesRef.current[toolKey];
        updateConfig(tool, { selectedModules: [] });

        const api = createLeappApi(tool);
        const selectionUpdates: Record<string, boolean> = {};
        toolState.modules.forEach((m: Module) => selectionUpdates[m.name] = false);

        try {
            await api.modules.select(selectionUpdates);
        } catch (error) {
            console.error(`Failed to select none for ${tool}:`, error);
        }
    }, [updateConfig]);

    const connectToStream = useCallback((tool: string, taskId: string, reportName?: string | null) => {
        // Close any existing connection for this tool
        if (eventSourceRefs.current[tool]) {
            eventSourceRefs.current[tool].close();
        }

        const api = createLeappApi(tool);
        const eventSource = api.processing.createEventSource(taskId);
        eventSourceRefs.current[tool] = eventSource;

        eventSource.onmessage = (event: MessageEvent) => {
            const message = event.data;
            if (message && message !== 'Stream ended') {
                setPersistedStates(prev => {
                    const toolKey = tool as keyof LeappPersistedState;
                    const toolState = prev[toolKey];
                    let logToAdd = message;

                    let nextProgress = toolState.processing.progress;
                    let nextEnc = toolState.processing.encryptionDetected;

                    if (message.includes("Detected encrypted iTunes backup") && !toolState.processing.passwordProvided) {
                        nextEnc = true;
                    }

                    if (message.includes("Could not unwrap a protection class key") || message.includes("Incorrect password")) {
                        window.dispatchEvent(new CustomEvent('leapp-password-error', { detail: { tool } }));
                    }

                    // iLEAPP emits [X/Y] progress natively
                    const nativeMatch = message.match(/\[(\d+)\/(\d+)\]/);
                    if (nativeMatch) {
                        nextProgress = {
                            current: parseInt(nativeMatch[1], 10),
                            total: parseInt(nativeMatch[2], 10)
                        };
                    } else if (message.includes('artifact started') && nextProgress.total > 0) {
                        // aLEAPP fallback: Inject [X/Y] into the log message for UI consistency
                        const newCurrent = Math.min(nextProgress.current + 1, nextProgress.total);
                        nextProgress = {
                            current: newCurrent,
                            total: nextProgress.total
                        };
                        logToAdd = `[${newCurrent}/${nextProgress.total}] ${message}`;
                    }

                    const currentLogs = toolState.processing.logs;
                    const nextLogs = currentLogs.length >= MAX_LOGS
                        ? [...currentLogs.slice(-(MAX_LOGS - 1)), logToAdd]
                        : [...currentLogs, logToAdd];

                    return {
                        ...prev,
                        [tool]: {
                            ...toolState,
                            processing: {
                                ...toolState.processing,
                                logs: nextLogs,
                                progress: nextProgress,
                                encryptionDetected: nextEnc
                            }
                        }
                    };
                });
            }
        };

        eventSource.addEventListener('close', () => {
            eventSource.close();
            delete eventSourceRefs.current[tool];
            updateProcessing(tool, {
                isProcessing: false
            });
        });

        eventSource.onerror = () => {
            eventSource.close();
            delete eventSourceRefs.current[tool];
            setPersistedStates(prev => {
                const toolKey = tool as keyof LeappPersistedState;
                return {
                    ...prev,
                    [tool]: {
                        ...prev[toolKey],
                        processing: {
                            ...prev[toolKey].processing,
                            isProcessing: false,
                            logs: [...prev[toolKey].processing.logs, 'Error: Connection to server lost']
                        }
                    }
                };
            });
        };

        return eventSource;
    }, [updateProcessing]);

    // Reconnect to active processing tasks on mount or case switch
    // Uses readyToReconnect to ensure state is fully propagated before checking
    useEffect(() => {
        if (!readyToReconnect || readyToReconnect !== selectedCaseId) return;

        // Use states directly (not statesRef) to ensure we have the latest values
        (['ileapp', 'aleapp'] as const).forEach(tool => {
            const { isProcessing, taskId, processingReportName } = states[tool].processing;
            // Only reconnect if processing and no existing connection
            if (isProcessing && taskId && !eventSourceRefs.current[tool]) {
                console.log(`Reconnecting to ${tool} processing task: ${taskId}`);
                connectToStream(tool, taskId, processingReportName);
            }
        });
    }, [readyToReconnect, selectedCaseId, states, connectToStream]);

    const startProcessing = async (
        tool: string,
        inputFile: string,
        outputFolder: string,
        reportName?: string,
        password?: string,
        caseId?: number
    ) => {
        const toolKey = tool as keyof LeappPersistedState;
        const selectedModules = persistedStates[toolKey].config.selectedModules;
        const api = createLeappApi(tool);
        const currentTaskId = persistedStates[toolKey].processing.taskId;

        // Reset state - set total from selected modules count so aLEAPP can track progress
        const moduleCount = selectedModules ? selectedModules.length : 0;
        
        updateProcessing(tool, {
            logs: [],
            progress: { current: 0, total: moduleCount },
            encryptionDetected: false,
            passwordProvided: !!password,
            isProcessing: true,
            processingReportName: reportName || null,
            taskId: null // Clear old task ID immediately
        });

        try {
            if (currentTaskId) {
                try { await api.processing.stop(currentTaskId); } catch (e) { console.warn("Failed to stop previous task", e); }
            }

            const response = await api.processing.start(inputFile, outputFolder, selectedModules || [], reportName, password, caseId);
            updateProcessing(tool, { taskId: response.task_id });

            connectToStream(tool, response.task_id, reportName);
        } catch (error) {
            const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            setPersistedStates(prev => ({
                ...prev,
                [tool]: {
                    ...prev[toolKey],
                    processing: {
                        ...prev[toolKey].processing,
                        isProcessing: false,
                        processingReportName: null,
                        logs: [...prev[toolKey].processing.logs, errorMessage]
                    }
                }
            }));
        }
    };

    const stopProcessing = async (tool: string) => {
        const toolKey = tool as keyof LeappPersistedState;
        const taskId = persistedStates[toolKey].processing.taskId;
        if (!taskId) return;

        const api = createLeappApi(tool);
        try {
            await api.processing.stop(taskId);
            updateProcessing(tool, {
                isProcessing: false,
                processingReportName: null,
                logs: [...persistedStates[toolKey].processing.logs, 'Processing stopped by user']
            });
        } catch (error) {
            console.error('Failed to stop processing:', error);
        }
    };

    const clearLogs = (tool: string) => {
        updateProcessing(tool, {
            logs: [],
            progress: { current: 0, total: 0 }
        });
    };

    const clearProcessingReportName = (tool: string) => {
        updateProcessing(tool, { processingReportName: null });
    };

    return (
        <LeappContext.Provider value={{
            states,
            updateConfig,
            fetchModules,
            toggleModule,
            selectAll,
            selectNone,
            startProcessing,
            stopProcessing,
            clearLogs,
            clearProcessingReportName
        }}>
            {children}
        </LeappContext.Provider>
    );
}

export function useLeapp() {
    const context = useContext(LeappContext);
    if (context === undefined) {
        throw new Error('useLeapp must be used within a LeappProvider');
    }
    return context;
}
