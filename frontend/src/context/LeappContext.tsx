
import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode, useMemo } from 'react'
import { useCase } from './CaseContext';
import { createLeappApi } from '@/lib/leappApi'
import { Module } from '@/types/leapp';
import { useCasePersistedState } from '@/hooks/useCasePersistedState';
import { useLeappProcessing, LeappProcessingState, INITIAL_LEAPP_PROCESSING } from '@/hooks/useLeappProcessing';

interface ToolConfig {
    inputFile: string;
    reportName: string;
    selectedModules: string[] | null;
    artifactScrollPos: number;
    logScrollPos: Record<string, number>;
}

interface ToolState {
    config: ToolConfig;
    processing: {
        logs: string[];
        isProcessing: boolean;
        progress: { current: number; total: number };
        taskId: string | null;
        processingReportName: string | null;
        encryptionDetected: boolean;
        passwordProvided: boolean;
    };
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

const STORAGE_KEY_PREFIX = 'suitedfir_leapp_configs_';

const INITIAL_CONFIG: ToolConfig = {
    inputFile: '',
    reportName: '',
    selectedModules: null,
    artifactScrollPos: 0,
    logScrollPos: {}
};

interface LeappPersistedState {
    ileapp: { config: ToolConfig; processing: LeappProcessingState };
    aleapp: { config: ToolConfig; processing: LeappProcessingState };
}

const INITIAL_STATE: LeappPersistedState = {
    ileapp: { config: { ...INITIAL_CONFIG }, processing: { ...INITIAL_LEAPP_PROCESSING } },
    aleapp: { config: { ...INITIAL_CONFIG }, processing: { ...INITIAL_LEAPP_PROCESSING } }
};

// Map from internal hook state shape (isRunning) to public API shape (isProcessing)
function mapProcessingToPublic(p: LeappProcessingState) {
    return {
        logs: p.logs,
        isProcessing: p.isRunning,
        progress: p.progress,
        taskId: p.taskId,
        processingReportName: p.processingReportName,
        encryptionDetected: p.encryptionDetected,
        passwordProvided: p.passwordProvided,
    };
}

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

    const statesRef = useRef<LeappPersistedState>(persistedStates);
    useEffect(() => { statesRef.current = persistedStates; }, [persistedStates]);

    // Per-tool processing hooks
    const setIleappProcessing = useCallback((updater: (prev: LeappProcessingState) => LeappProcessingState) => {
        setPersistedStates(prev => ({
            ...prev,
            ileapp: { ...prev.ileapp, processing: updater(prev.ileapp.processing) }
        }));
    }, [setPersistedStates]);

    const setAleappProcessing = useCallback((updater: (prev: LeappProcessingState) => LeappProcessingState) => {
        setPersistedStates(prev => ({
            ...prev,
            aleapp: { ...prev.aleapp, processing: updater(prev.aleapp.processing) }
        }));
    }, [setPersistedStates]);

    const ileappProcessing = useLeappProcessing({
        tool: 'ileapp',
        processing: persistedStates.ileapp.processing,
        setProcessing: setIleappProcessing,
        isLoaded,
    });

    const aleappProcessing = useLeappProcessing({
        tool: 'aleapp',
        processing: persistedStates.aleapp.processing,
        setProcessing: setAleappProcessing,
        isLoaded,
    });

    const processingHooks = useMemo(() => ({
        ileapp: ileappProcessing,
        aleapp: aleappProcessing,
    }), [ileappProcessing, aleappProcessing]);

    // Derived states for public API
    const states = useMemo(() => ({
        ileapp: {
            ...transientStates.ileapp,
            config: persistedStates.ileapp.config,
            processing: mapProcessingToPublic(persistedStates.ileapp.processing),
        },
        aleapp: {
            ...transientStates.aleapp,
            config: persistedStates.aleapp.config,
            processing: mapProcessingToPublic(persistedStates.aleapp.processing),
        },
    }), [persistedStates, transientStates]);

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

    const fetchModules = useCallback(async (tool: string) => {
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
                [tool]: { ...prev[tool], modules: data.modules, isLoadingModules: false }
            }));

            setPersistedStates(prev => {
                const currentSelection = prev[tool as keyof LeappPersistedState].config.selectedModules;
                const finalSelected = currentSelection !== null ? currentSelection : selectedModuleNames;
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
        const toolState = { ...transientStates[tool], ...persistedStates[toolKey] };
        const allModuleNames = (toolState as unknown as { modules: Module[] }).modules?.map((m: Module) => m.name) || [];

        updateConfig(tool, { selectedModules: allModuleNames });

        const api = createLeappApi(tool);
        const selectionUpdates: Record<string, boolean> = {};
        allModuleNames.forEach(name => selectionUpdates[name] = true);

        try {
            await api.modules.select(selectionUpdates);
        } catch (error) {
            console.error(`Failed to select all modules for ${tool}:`, error);
        }
    }, [updateConfig, transientStates, persistedStates]);

    const selectNone = useCallback(async (tool: string) => {
        const toolKey = tool as keyof LeappPersistedState;
        const toolState = { ...transientStates[tool], ...persistedStates[toolKey] };
        const modules = (toolState as unknown as { modules: Module[] }).modules || [];
        updateConfig(tool, { selectedModules: [] });

        const api = createLeappApi(tool);
        const selectionUpdates: Record<string, boolean> = {};
        modules.forEach((m: Module) => selectionUpdates[m.name] = false);

        try {
            await api.modules.select(selectionUpdates);
        } catch (error) {
            console.error(`Failed to select none for ${tool}:`, error);
        }
    }, [updateConfig, transientStates, persistedStates]);

    const startProcessing = useCallback(async (
        tool: string, inputFile: string, outputFolder: string,
        reportName?: string, password?: string, caseId?: number
    ) => {
        const toolKey = tool as keyof LeappPersistedState;
        const selectedModules = persistedStates[toolKey].config.selectedModules || [];
        const hook = processingHooks[toolKey];
        await hook.startProcessing(inputFile, outputFolder, selectedModules, reportName, password, caseId);
    }, [persistedStates, processingHooks]);

    const stopProcessing = useCallback(async (tool: string) => {
        const toolKey = tool as keyof LeappPersistedState;
        await processingHooks[toolKey].stopProcessing();
    }, [processingHooks]);

    const clearLogs = useCallback((tool: string) => {
        const toolKey = tool as keyof LeappPersistedState;
        processingHooks[toolKey].clearLogs();
    }, [processingHooks]);

    const clearProcessingReportName = useCallback((tool: string) => {
        const toolKey = tool as keyof LeappPersistedState;
        processingHooks[toolKey].clearProcessingReportName();
    }, [processingHooks]);

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
