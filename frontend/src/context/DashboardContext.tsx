
import { createContext, useContext, ReactNode } from 'react'

interface DashboardContextType {
    activeTab: 'tasks' | 'notes';
    taskInput: string;
    taskDescription: string;
    taskPriority: 'Low' | 'Medium' | 'High';
    noteInput: string;
    noteDescription: string;

    setActiveTab: (tab: 'tasks' | 'notes') => void;
    setTaskInput: (val: string) => void;
    setTaskDescription: (val: string) => void;
    setTaskPriority: (val: 'Low' | 'Medium' | 'High') => void;
    setNoteInput: (val: string) => void;
    setNoteDescription: (val: string) => void;

    isStateLoaded: boolean;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined)

import { useCasePersistedState } from '@/hooks/useCasePersistedState';

const STORAGE_KEY_PREFIX = 'suitedfir_dashboard_state_';

interface StoredState {
    activeTab: 'tasks' | 'notes';
    taskInput: string;
    taskDescription: string;
    taskPriority: 'Low' | 'Medium' | 'High';
    noteInput: string;
    noteDescription: string;
}

const INITIAL_STATE: StoredState = {
    activeTab: 'tasks',
    taskInput: '',
    taskDescription: '',
    taskPriority: 'Medium',
    noteInput: '',
    noteDescription: ''
};

export function DashboardProvider({ children }: { children: ReactNode }) {
    const [state, setState, isStateLoaded] = useCasePersistedState<StoredState>(
        STORAGE_KEY_PREFIX,
        INITIAL_STATE
    );

    const setActiveTab = (tab: 'tasks' | 'notes') => setState(prev => ({ ...prev, activeTab: tab }));
    const setTaskInput = (val: string) => setState(prev => ({ ...prev, taskInput: val }));
    const setTaskDescription = (val: string) => setState(prev => ({ ...prev, taskDescription: val }));
    const setTaskPriority = (val: 'Low' | 'Medium' | 'High') => setState(prev => ({ ...prev, taskPriority: val }));
    const setNoteInput = (val: string) => setState(prev => ({ ...prev, noteInput: val }));
    const setNoteDescription = (val: string) => setState(prev => ({ ...prev, noteDescription: val }));

    return (
        <DashboardContext.Provider value={{
            ...state,
            setActiveTab,
            setTaskInput,
            setTaskDescription,
            setTaskPriority,
            setNoteInput,
            setNoteDescription,
            isStateLoaded
        }}>
            {children}
        </DashboardContext.Provider>
    )
}

export function useDashboard() {
    const context = useContext(DashboardContext)
    if (context === undefined) {
        throw new Error('useDashboard must be used within a DashboardProvider')
    }
    return context
}
