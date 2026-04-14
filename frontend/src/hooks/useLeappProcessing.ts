import { useCallback, useEffect, useRef } from 'react';
import { useEventSourceStream } from './useEventSourceStream';
import { useProcessingState } from './useProcessingState';
import { createLeappApi } from '../services/leappApi';
import { useCase } from '../context/CaseContext';

const MAX_LOGS = 2000;

export interface LeappProcessingState {
    logs: string[];
    isRunning: boolean;
    progress: { current: number; total: number };
    taskId: string | null;
    processingReportName: string | null;
    encryptionDetected: boolean;
    passwordProvided: boolean;
}

export const INITIAL_LEAPP_PROCESSING: LeappProcessingState = {
    logs: [],
    isRunning: false,
    progress: { current: 0, total: 0 },
    taskId: null,
    processingReportName: null,
    encryptionDetected: false,
    passwordProvided: false,
};

interface UseLeappProcessingOptions {
    tool: string;
    processing: LeappProcessingState;
    setProcessing: (updater: (prev: LeappProcessingState) => LeappProcessingState) => void;
    isLoaded: boolean;
}

export function useLeappProcessing({
    tool,
    processing,
    setProcessing,
    isLoaded,
}: UseLeappProcessingOptions) {
    const { selectedCaseId } = useCase();
    const processingRef = useRef(processing);
    processingRef.current = processing;

    const { clearLogs: _baseClearLogs, patch } = useProcessingState({
        state: processing,
        setState: setProcessing,
        maxLogs: MAX_LOGS,
    });

    const stream = useEventSourceStream<string>();

    const connectToStream = useCallback((toolKey: string, taskId: string) => {
        const api = createLeappApi(toolKey);
        const eventSource = api.processing.createEventSource(taskId);

        stream.connect(toolKey, eventSource, {
            onMessage: (event: MessageEvent<string>) => {
                const message = event.data;
                if (!message || message === 'Stream ended') return;

                setProcessing(prev => {
                    let logToAdd = message;
                    let nextProgress = prev.progress;
                    let nextEnc = prev.encryptionDetected;

                    if (message.includes('Detected encrypted iTunes backup') && !prev.passwordProvided) {
                        nextEnc = true;
                    }

                    if (message.includes('Could not unwrap a protection class key') || message.includes('Incorrect password')) {
                        window.dispatchEvent(new CustomEvent('leapp-password-error', { detail: { tool: toolKey } }));
                    }

                    const nativeMatch = message.match(/\[(\d+)\/(\d+)\]/);
                    if (nativeMatch) {
                        nextProgress = {
                            current: parseInt(nativeMatch[1], 10),
                            total: parseInt(nativeMatch[2], 10),
                        };
                    } else if (message.includes('artifact started') && nextProgress.total > 0) {
                        const newCurrent = Math.min(nextProgress.current + 1, nextProgress.total);
                        nextProgress = { current: newCurrent, total: nextProgress.total };
                        logToAdd = `[${newCurrent}/${nextProgress.total}] ${message}`;
                    }

                    const currentLogs = prev.logs;
                    const nextLogs = currentLogs.length >= MAX_LOGS
                        ? [...currentLogs.slice(-(MAX_LOGS - 1)), logToAdd]
                        : [...currentLogs, logToAdd];

                    return {
                        ...prev,
                        logs: nextLogs,
                        progress: nextProgress,
                        encryptionDetected: nextEnc,
                    };
                });
            },
            onClose: () => {
                setProcessing(prev => ({ ...prev, isRunning: false }));
            },
            onError: () => {
                setProcessing(prev => ({
                    ...prev,
                    isRunning: false,
                    logs: [...prev.logs, 'Error: Connection to server lost'],
                }));
            },
        });
    }, [stream, setProcessing]);

    // Reconnect to active processing tasks on mount or case switch
    useEffect(() => {
        if (!isLoaded || !selectedCaseId) return;

        const { isRunning, taskId } = processingRef.current;
        if (isRunning && taskId && !stream.hasConnection(tool)) {
            console.log(`Reconnecting to ${tool} processing task: ${taskId}`);
            connectToStream(tool, taskId);
        }
    }, [isLoaded, selectedCaseId, tool, stream, connectToStream, processing.taskId, processing.isRunning]);

    const startProcessing = useCallback(async (
        inputFile: string,
        outputFolder: string,
        selectedModules: string[],
        reportName?: string,
        password?: string,
        caseId?: number,
    ) => {
        const api = createLeappApi(tool);
        const currentTaskId = processingRef.current.taskId;
        const moduleCount = selectedModules.length;

        setProcessing(prev => ({
            ...prev,
            logs: [],
            progress: { current: 0, total: moduleCount },
            encryptionDetected: false,
            passwordProvided: !!password,
            isRunning: true,
            processingReportName: reportName || null,
            taskId: null,
        }));

        try {
            if (currentTaskId) {
                try { await api.processing.stop(currentTaskId); } catch (e) { console.warn('Failed to stop previous task', e); }
            }

            const response = await api.processing.start(inputFile, outputFolder, selectedModules, reportName, password, caseId);
            setProcessing(prev => ({ ...prev, taskId: response.task_id }));
            connectToStream(tool, response.task_id);
        } catch (error) {
            const errorMessage = `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
            setProcessing(prev => ({
                ...prev,
                isRunning: false,
                processingReportName: null,
                logs: [...prev.logs, errorMessage],
            }));
        }
    }, [tool, connectToStream, setProcessing]);

    const stopProcessing = useCallback(async () => {
        const taskId = processingRef.current.taskId;
        if (!taskId) return;

        const api = createLeappApi(tool);
        try {
            await api.processing.stop(taskId);
            setProcessing(prev => ({
                ...prev,
                isRunning: false,
                processingReportName: null,
                logs: [...prev.logs, 'Processing stopped by user'],
            }));
        } catch (error) {
            console.error('Failed to stop processing:', error);
        }
    }, [tool, setProcessing]);

    const clearLogs = useCallback(() => {
        setProcessing(prev => ({
            ...prev,
            logs: [],
            progress: { current: 0, total: 0 },
        }));
    }, [setProcessing]);

    const clearProcessingReportName = useCallback(() => {
        patch({ processingReportName: null } as Partial<LeappProcessingState>);
    }, [patch]);

    return {
        startProcessing,
        stopProcessing,
        clearLogs,
        clearProcessingReportName,
    };
}
