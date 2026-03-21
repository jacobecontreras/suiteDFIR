
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react'
import { useCase } from './CaseContext';
import { createLeappApi } from '../services/leappApi'
import { API } from '@/lib/api'

import { Device, Backup } from '../types/backup'

interface BackupConfig {
    backupName: string;
    selectedDevice: string;
    isEncrypted: boolean;
    backupPassword: string;
    logScrollPos: Record<string, number>;
}

interface BackupState {
    config: BackupConfig;
    devices: Device[];
    backups: Backup[];
    logs: string[];
    isBackingUp: boolean;
    isLoadingDevices: boolean;
    activeBackupId: number | null;
    progressLogs: Record<string, string>;
    isAwaitingDevicePasscode: boolean;
}

interface BackupContextType extends BackupState {
    updateConfig: (updates: Partial<BackupConfig>) => void;
    fetchDevices: () => Promise<void>;
    fetchBackups: (caseId?: string) => Promise<void>;
    startBackup: (udid: string, name: string, caseId?: number) => void;
    stopBackup: (backupId: number) => Promise<void>;
    clearLogs: () => void;
}

// Two separate contexts — one per platform
const IosBackupContext = createContext<BackupContextType | undefined>(undefined);
const AndroidBackupContext = createContext<BackupContextType | undefined>(undefined);

import { useCasePersistedState } from '@/hooks/useCasePersistedState';

interface BackupPersistedState {
    config: BackupConfig;
    logs: string[];
    isBackingUp: boolean;
    activeBackupId: number | null;
    progressLogs: Record<string, string>;
    isAwaitingDevicePasscode: boolean;
}

const INITIAL_CONFIG: BackupConfig = {
    backupName: '',
    selectedDevice: '',
    isEncrypted: false,
    backupPassword: '',
    logScrollPos: {}
};

const INITIAL_STATE: BackupPersistedState = {
    config: INITIAL_CONFIG,
    logs: [],
    isBackingUp: false,
    activeBackupId: null,
    progressLogs: {},
    isAwaitingDevicePasscode: false
};

interface BackupProviderProps {
    type: 'ios' | 'android';
    children: ReactNode;
}

export function BackupProvider({ type, children }: BackupProviderProps) {
    // Scope persisted state by platform type
    const STORAGE_KEY_PREFIX = `suitedfir_backup_config_${type}_`;

    const [state, setState, isLoaded] = useCasePersistedState<BackupPersistedState>(
        STORAGE_KEY_PREFIX,
        INITIAL_STATE
    );

    const { config, logs, isBackingUp, activeBackupId, progressLogs, isAwaitingDevicePasscode } = state;

    const setConfig = useCallback((updates: Partial<BackupConfig>) => {
        setState(prev => ({ ...prev, config: { ...prev.config, ...updates } }));
    }, [setState]);

    const setLogs = useCallback((val: string[] | ((prev: string[]) => string[])) => {
        setState(prev => ({ ...prev, logs: typeof val === 'function' ? val(prev.logs) : val }));
    }, [setState]);

    const setProgressLogs = useCallback((val: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => {
        setState(prev => ({ ...prev, progressLogs: typeof val === 'function' ? val(prev.progressLogs) : val }));
    }, [setState]);

    const setIsBackingUp = useCallback((val: boolean) => {
        setState(prev => ({ ...prev, isBackingUp: val }));
    }, [setState]);

    const setActiveBackupId = useCallback((val: number | null) => {
        setState(prev => ({ ...prev, activeBackupId: val }));
    }, [setState]);

    const setIsAwaitingDevicePasscode = useCallback((val: boolean) => {
        setState(prev => ({ ...prev, isAwaitingDevicePasscode: val }));
    }, [setState]);

    const [devices, setDevices] = useState<Device[]>([]);
    const [backups, setBackups] = useState<Backup[]>([]);
    const [hasFetchedBackups, setHasFetchedBackups] = useState(false);
    const [isLoadingDevices, setIsLoadingDevices] = useState(false);

    const { selectedCaseId } = useCase(); // Get selected case ID

    const api = React.useMemo(() => createLeappApi('ios'), []);
    const logStreamRef = useRef<EventSource | null>(null);
    const isStartingBackupRef = useRef(false);

    const updateConfig = setConfig;

    const fetchDevices = useCallback(async () => {
        setIsLoadingDevices(true);
        try {
            const data = await api.backup.getDevices();
            setDevices(data);
        } catch (error) {
            console.error('Failed to fetch devices:', error);
        } finally {
            setIsLoadingDevices(false);
        }
    }, [api]);

    const fetchBackups = useCallback(async (caseId?: string) => {
        // Use provided caseId or fall back to selectedCaseId from context
        const targetCaseId = caseId || selectedCaseId;

        try {
            const data = await api.backup.getBackups(targetCaseId ? parseInt(targetCaseId) : undefined);
            setBackups(data);
        } catch (error) {
            console.error('Failed to fetch backups:', error);
        } finally {
            setHasFetchedBackups(true);
        }
    }, [api, selectedCaseId]);

    // unified stream for background updates
    useEffect(() => {
        fetchDevices();
        fetchBackups();

        const eventSource = new EventSource(API.path('/stream'));

        eventSource.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                if (message.type === 'device_update') {
                    setDevices(message.data);
                } else if (message.type === 'backup_update') {
                    fetchBackups();
                }
            } catch (error) {
                console.error('Failed to parse SSE message:', error);
            }
        };

        return () => eventSource.close();
    }, [fetchDevices, fetchBackups]);

    const connectToLogStream = useCallback((backupId: number, keepExisting = false) => {
        if (logStreamRef.current) {
            logStreamRef.current.close();
            logStreamRef.current = null;
        }

        if (!keepExisting) setLogs([]);

        const eventSource = new EventSource(API.path(`/backups/${backupId}/stream`));
        logStreamRef.current = eventSource;

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'log') {
                    if (type === 'ios') {
                        setIsAwaitingDevicePasscode(false);
                    }
                    setLogs(prev => [...prev, data.message]);
                } else if (data.type === 'progress') {
                    if (type === 'ios') {
                        setIsAwaitingDevicePasscode(false);
                    }
                    setProgressLogs(prev => ({
                        ...prev,
                        [data.progress_type]: data.message
                    }));

                    const shouldUpdateOverallProgress = data.progress_type === 'overall';
                    const percentMatch = shouldUpdateOverallProgress && typeof data.message === 'string'
                        ? data.message.match(/(\d+(?:\.\d+)?)%/)
                        : null;

                    if (percentMatch && percentMatch[1]) {
                        const progress = Math.round(parseFloat(percentMatch[1]));
                        setBackups(prev => prev.map(backup => (
                            backup.id === backupId
                                ? { ...backup, progress }
                                : backup
                        )));
                    }
                } else if (data.type === 'prompt' && data.prompt_type === 'device_passcode' && type === 'ios') {
                    setIsAwaitingDevicePasscode(true);
                }
            } catch (error) {
                // Fallback for older non-JSON logs
                if (typeof event.data === 'string' && event.data.trim()) {
                    if (type === 'ios') {
                        setIsAwaitingDevicePasscode(false);
                    }
                    setLogs(prev => [...prev, event.data]);
                }
            }
        };

        eventSource.addEventListener('close', () => {
            eventSource.close();
            if (logStreamRef.current === eventSource) {
                logStreamRef.current = null;
            }
            setIsBackingUp(false);
            setActiveBackupId(null);
            setIsAwaitingDevicePasscode(false);
            fetchBackups();
        });

        eventSource.onerror = () => {
            if (eventSource.readyState !== 2) {
                console.error('Backup log stream failed');
            }
            eventSource.close();
            if (logStreamRef.current === eventSource) {
                logStreamRef.current = null;
            }
            // We don't necessarily stop isBackingUp here, polling will catch it
            setIsAwaitingDevicePasscode(false);
            fetchBackups();
        };

        return eventSource;
    }, [fetchBackups]);

    const startBackup = async (udid: string, name: string, caseId?: number) => {
        isStartingBackupRef.current = true;
        setIsBackingUp(true);
        setLogs([
            "Initializing backup process...",
            "Please wait while we prepare the device...",
            "NOTE: You may see a prompt on your device to enter your passcode to trust this computer."
        ]);
        setProgressLogs({});
        setIsAwaitingDevicePasscode(type === 'ios');
        try {
            const password = config.isEncrypted ? config.backupPassword : undefined;
            const response = await api.backup.startBackup(udid, name, caseId, password);
            if (response.backup_id) {
                setActiveBackupId(response.backup_id);
                setIsBackingUp(true);
                connectToLogStream(response.backup_id, true);
            }
            await fetchBackups(caseId?.toString());
            // Clear encryption state after successful start
            updateConfig({ isEncrypted: false, backupPassword: '' });
        } catch (error) {
            console.error('Failed to start backup:', error);
            setIsBackingUp(false);
            setIsAwaitingDevicePasscode(false);
            throw error;
        } finally {
            isStartingBackupRef.current = false;
        }
    };

    const stopBackup = async (backupId: number) => {
        try {
            await fetch(API.path(`/backups/${backupId}/stop`), { method: 'POST' });
            setIsBackingUp(false);
            setActiveBackupId(null);
            setIsAwaitingDevicePasscode(false);
            if (logStreamRef.current) {
                logStreamRef.current.close();
                logStreamRef.current = null;
            }
            fetchBackups();
        } catch (error) {
            console.error('Failed to stop backup:', error);
            throw error;
        }
    };

    const clearLogs = () => {
        setLogs([]);
        setProgressLogs({});
        setIsAwaitingDevicePasscode(false);
    };

    // Auto-reconnect to log stream if backup is in progress
    // Filter to only backups matching THIS provider's platform type
    useEffect(() => {
        if (!hasFetchedBackups) return;

        const platformBackups = backups.filter(b => b.type === type);
        const activeBackup = platformBackups.find(b => b.status === 'in_progress');

        if (activeBackup && !logStreamRef.current) {
            setIsBackingUp(true);
            setActiveBackupId(activeBackup.id);
            connectToLogStream(activeBackup.id, true);
        } else if (!activeBackup && isBackingUp) {
            if (isStartingBackupRef.current || activeBackupId !== null || logStreamRef.current) {
                return;
            }
            // Fallback: If we think we are backing up, but the API says no backups are active, reset
            setIsBackingUp(false);
            setActiveBackupId(null);
            setIsAwaitingDevicePasscode(false);
        }
    }, [backups, isBackingUp, hasFetchedBackups, connectToLogStream, setIsBackingUp, setActiveBackupId, activeBackupId, type, setIsAwaitingDevicePasscode]);

    const value = {
        config,
        devices,
        backups,
        logs,
        progressLogs,
        isBackingUp,
        isLoadingDevices,
        activeBackupId,
        isAwaitingDevicePasscode,
        updateConfig,
        fetchDevices,
        fetchBackups,
        startBackup,
        stopBackup,
        clearLogs
    };

    // Provide to the correct context based on type
    const Context = type === 'ios' ? IosBackupContext : AndroidBackupContext;

    return (
        <Context.Provider value={value}>
            {children}
        </Context.Provider>
    );
}

export function useBackup(type: 'ios' | 'android') {
    const context = useContext(type === 'ios' ? IosBackupContext : AndroidBackupContext);
    if (context === undefined) {
        throw new Error(`useBackup('${type}') must be used within a <BackupProvider type="${type}">`);
    }
    return context;
}
