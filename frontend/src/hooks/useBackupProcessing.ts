import { useCallback, useEffect, useRef } from 'react';
import { useEventSourceStream } from './useEventSourceStream';
import { API } from '@/lib/api';
import { Backup } from '../types/backup';

export interface BackupProcessingState {
    logs: string[];
    isRunning: boolean;
    activeBackupId: number | null;
    progressLogs: Record<string, string>;
    isAwaitingDevicePasscode: boolean;
}

export const INITIAL_BACKUP_PROCESSING: BackupProcessingState = {
    logs: [],
    isRunning: false,
    activeBackupId: null,
    progressLogs: {},
    isAwaitingDevicePasscode: false,
};

interface UseBackupProcessingOptions {
    type: 'ios' | 'android';
    processing: BackupProcessingState;
    setProcessing: (updater: (prev: BackupProcessingState) => BackupProcessingState) => void;
    setBackups: React.Dispatch<React.SetStateAction<Backup[]>>;
    fetchBackups: (caseId?: string) => Promise<void>;
    hasFetchedBackups: boolean;
    backups: Backup[];
}

export function useBackupProcessing({
    type,
    processing,
    setProcessing,
    setBackups,
    fetchBackups,
    hasFetchedBackups,
    backups,
}: UseBackupProcessingOptions) {
    const processingRef = useRef(processing);
    processingRef.current = processing;
    const isStartingRef = useRef(false);

    const stream = useEventSourceStream<number>();

    const connectToLogStream = useCallback((backupId: number, keepExisting = false) => {
        if (!keepExisting) {
            setProcessing(prev => ({ ...prev, logs: [] }));
        }

        const eventSource = new EventSource(API.path(`/backups/${backupId}/stream`));

        stream.connect(backupId, eventSource, {
            onMessage: (event: MessageEvent<string>) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'log') {
                        if (type === 'ios') {
                            setProcessing(prev => ({ ...prev, isAwaitingDevicePasscode: false }));
                        }
                        setProcessing(prev => ({ ...prev, logs: [...prev.logs, data.message] }));
                    } else if (data.type === 'progress') {
                        if (type === 'ios') {
                            setProcessing(prev => ({ ...prev, isAwaitingDevicePasscode: false }));
                        }
                        setProcessing(prev => ({
                            ...prev,
                            progressLogs: { ...prev.progressLogs, [data.progress_type]: data.message },
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
                        setProcessing(prev => ({ ...prev, isAwaitingDevicePasscode: true }));
                    }
                } catch {
                    // Fallback for older non-JSON logs
                    if (typeof event.data === 'string' && event.data.trim()) {
                        if (type === 'ios') {
                            setProcessing(prev => ({ ...prev, isAwaitingDevicePasscode: false }));
                        }
                        setProcessing(prev => ({ ...prev, logs: [...prev.logs, event.data] }));
                    }
                }
            },
            onClose: () => {
                setProcessing(prev => ({
                    ...prev,
                    isRunning: false,
                    activeBackupId: null,
                    isAwaitingDevicePasscode: false,
                }));
                fetchBackups();
            },
            onError: (event: Event) => {
                if ((event.target as EventSource)?.readyState !== 2) {
                    console.error('Backup log stream failed');
                }
                setProcessing(prev => ({ ...prev, isAwaitingDevicePasscode: false }));
                fetchBackups();
            },
        });

        return eventSource;
    }, [type, stream, setProcessing, setBackups, fetchBackups]);

    // Auto-reconnect to log stream if backup is in progress
    useEffect(() => {
        if (!hasFetchedBackups) return;

        const platformBackups = backups.filter(b => b.type === type);
        const activeBackup = platformBackups.find(b => b.status === 'in_progress');
        const { isRunning, activeBackupId } = processingRef.current;

        if (activeBackup && !stream.hasConnection(activeBackup.id)) {
            setProcessing(prev => ({
                ...prev,
                isRunning: true,
                activeBackupId: activeBackup.id,
            }));
            connectToLogStream(activeBackup.id, true);
        } else if (!activeBackup && isRunning) {
            if (isStartingRef.current || activeBackupId !== null || stream.hasConnection(activeBackupId!)) {
                return;
            }
            setProcessing(prev => ({
                ...prev,
                isRunning: false,
                activeBackupId: null,
                isAwaitingDevicePasscode: false,
            }));
        }
    }, [backups, hasFetchedBackups, type, stream, connectToLogStream, setProcessing, processing.isRunning, processing.activeBackupId]);

    const startBackup = useCallback(async (
        api: ReturnType<typeof import('@/lib/leappApi').createLeappApi>,
        udid: string,
        name: string,
        config: { isEncrypted: boolean; backupPassword: string },
        caseId?: number,
        updateConfig?: (updates: Record<string, unknown>) => void,
    ) => {
        isStartingRef.current = true;
        setProcessing(prev => ({
            ...prev,
            isRunning: true,
            logs: [
                'Initializing backup process...',
                'Please wait while we prepare the device...',
                'NOTE: You may see a prompt on your device to enter your passcode to trust this computer.',
            ],
            progressLogs: {},
            isAwaitingDevicePasscode: type === 'ios',
        }));

        try {
            const password = config.isEncrypted ? config.backupPassword : undefined;
            const response = await api.backup.startBackup(udid, name, caseId, password);
            if (response.backup_id) {
                setProcessing(prev => ({
                    ...prev,
                    activeBackupId: response.backup_id,
                    isRunning: true,
                }));
                connectToLogStream(response.backup_id, true);
            }
            await fetchBackups(caseId?.toString());
            updateConfig?.({ isEncrypted: false, backupPassword: '' });
        } catch (error) {
            console.error('Failed to start backup:', error);
            setProcessing(prev => ({
                ...prev,
                isRunning: false,
                isAwaitingDevicePasscode: false,
            }));
            throw error;
        } finally {
            isStartingRef.current = false;
        }
    }, [type, connectToLogStream, fetchBackups, setProcessing]);

    const stopBackup = useCallback(async (backupId: number) => {
        try {
            await fetch(API.path(`/backups/${backupId}/stop`), { method: 'POST' });
            setProcessing(prev => ({
                ...prev,
                isRunning: false,
                activeBackupId: null,
                isAwaitingDevicePasscode: false,
            }));
            stream.disconnect(backupId);
            fetchBackups();
        } catch (error) {
            console.error('Failed to stop backup:', error);
            throw error;
        }
    }, [stream, fetchBackups, setProcessing]);

    const clearLogs = useCallback(() => {
        setProcessing(prev => ({
            ...prev,
            logs: [],
            progressLogs: {},
            isAwaitingDevicePasscode: false,
        }));
    }, [setProcessing]);

    return {
        startBackup,
        stopBackup,
        clearLogs,
        connectToLogStream,
        isStartingRef,
    };
}
