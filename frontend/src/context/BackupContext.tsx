
import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useCase } from './CaseContext';
import { createLeappApi } from '@/lib/leappApi'
import { API } from '@/lib/api'
import { Device, Backup } from '../types/backup'
import { useCasePersistedState } from '@/hooks/useCasePersistedState';
import { useBackupProcessing, BackupProcessingState, INITIAL_BACKUP_PROCESSING } from '@/hooks/useBackupProcessing';

interface BackupConfig {
    backupName: string;
    selectedDevice: string;
    isEncrypted: boolean;
    backupPassword: string;
    logScrollPos: Record<string, number>;
}

interface BackupContextType {
    config: BackupConfig;
    devices: Device[];
    backups: Backup[];
    logs: string[];
    isBackingUp: boolean;
    isLoadingDevices: boolean;
    activeBackupId: number | null;
    progressLogs: Record<string, string>;
    isAwaitingDevicePasscode: boolean;
    updateConfig: (updates: Partial<BackupConfig>) => void;
    fetchDevices: () => Promise<void>;
    fetchBackups: (caseId?: string) => Promise<void>;
    startBackup: (udid: string, name: string, caseId?: number) => void;
    stopBackup: (backupId: number) => Promise<void>;
    clearLogs: () => void;
}

const IosBackupContext = createContext<BackupContextType | undefined>(undefined);
const AndroidBackupContext = createContext<BackupContextType | undefined>(undefined);

const INITIAL_CONFIG: BackupConfig = {
    backupName: '',
    selectedDevice: '',
    isEncrypted: false,
    backupPassword: '',
    logScrollPos: {}
};

interface BackupPersistedState {
    config: BackupConfig;
    processing: BackupProcessingState;
}

const INITIAL_STATE: BackupPersistedState = {
    config: INITIAL_CONFIG,
    processing: INITIAL_BACKUP_PROCESSING,
};

interface BackupProviderProps {
    type: 'ios' | 'android';
    children: ReactNode;
}

export function BackupProvider({ type, children }: BackupProviderProps) {
    const STORAGE_KEY_PREFIX = `suitedfir_backup_config_${type}_`;

    const [state, setState] = useCasePersistedState<BackupPersistedState>(
        STORAGE_KEY_PREFIX,
        INITIAL_STATE
    );

    const { config, processing } = state;

    const setConfig = useCallback((updates: Partial<BackupConfig>) => {
        setState(prev => ({ ...prev, config: { ...prev.config, ...updates } }));
    }, [setState]);

    const setProcessing = useCallback((updater: (prev: BackupProcessingState) => BackupProcessingState) => {
        setState(prev => ({ ...prev, processing: updater(prev.processing) }));
    }, [setState]);

    const [devices, setDevices] = useState<Device[]>([]);
    const [backups, setBackups] = useState<Backup[]>([]);
    const [hasFetchedBackups, setHasFetchedBackups] = useState(false);
    const [isLoadingDevices, setIsLoadingDevices] = useState(false);

    const { selectedCaseId } = useCase();

    // Bug fix: use `type` instead of hardcoded 'ios'
    const api = React.useMemo(() => createLeappApi(type), [type]);

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

    // Unified stream for background device/backup updates
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

    // Processing hook handles SSE log streaming, reconnection, start/stop
    const {
        startBackup: hookStartBackup,
        stopBackup,
        clearLogs,
    } = useBackupProcessing({
        type,
        processing,
        setProcessing,
        setBackups,
        fetchBackups,
        hasFetchedBackups,
        backups,
    });

    const startBackup = useCallback(async (udid: string, name: string, caseId?: number) => {
        await hookStartBackup(api, udid, name, config, caseId, updateConfig as (updates: Record<string, unknown>) => void);
    }, [hookStartBackup, api, config, updateConfig]);

    const value: BackupContextType = {
        config,
        devices,
        backups,
        logs: processing.logs,
        progressLogs: processing.progressLogs,
        isBackingUp: processing.isRunning,
        isLoadingDevices,
        activeBackupId: processing.activeBackupId,
        isAwaitingDevicePasscode: processing.isAwaitingDevicePasscode,
        updateConfig,
        fetchDevices,
        fetchBackups,
        startBackup,
        stopBackup,
        clearLogs
    };

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
