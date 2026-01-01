import { useState, createContext, useContext, ReactNode } from 'react';
import { createLeappApi } from '../services/leappApi';

interface ProcessingContextType {
  logs: string[];
  isProcessing: boolean;
  progress: { current: number; total: number };
  taskId: string | null;
  processingReportName: string | null;
  startProcessing: (inputFile: string, outputFolder: string, selectedModules: string[], reportName?: string, password?: string, caseId?: number, timezone?: string) => Promise<void>;
  stopProcessing: () => Promise<void>;
  clearLogs: () => void;
  clearProcessingReportName: () => void;
  tool: string;
  encryptionDetected: boolean;
}

const ProcessingContext = createContext<ProcessingContextType | undefined>(undefined);

export function ProcessingProvider({ children, tool }: { children: ReactNode; tool: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [encryptionDetected, setEncryptionDetected] = useState(false);
  const [processingReportName, setProcessingReportName] = useState<string | null>(null);

  const api = createLeappApi(tool);

  const startProcessing = async (
    inputFile: string,
    outputFolder: string,
    selectedModules: string[],
    reportName?: string,
    password?: string,
    caseId?: number,
    timezone?: string
  ) => {
    // Clear logs and progress at the start
    setLogs([]);
    setProgress({ current: 0, total: 0 });
    setEncryptionDetected(false);
    setIsProcessing(true);
    setProcessingReportName(reportName || null);

    try {
      // If we are restarting with a password, stop the previous task first
      if (taskId) {
        try {
          await api.processing.stop(taskId);
        } catch (e) {
          console.warn("Failed to stop previous task", e);
        }
      }

      const response = await api.processing.start(inputFile, outputFolder, selectedModules, reportName, password, caseId, timezone);
      setTaskId(response.task_id);

      // Set up EventSource for streaming logs
      const eventSource = api.processing.createEventSource(response.task_id);

      eventSource.onmessage = (event: MessageEvent) => {
        const message = event.data;
        if (message && message !== 'Stream ended') {
          setLogs((prev) => [...prev, message]);

          // Check for encryption detection
          // Only trigger if we didn't provide a password
          if (message.includes("Detected encrypted iTunes backup") && !password) {
            setEncryptionDetected(true);
          }

          // Parse progress from log message: [x/y]
          const match = message.match(/\[(\d+)\/(\d+)\]/);
          if (match) {
            setProgress({
              current: parseInt(match[1], 10),
              total: parseInt(match[2], 10)
            });
          }
        }
      };

      eventSource.addEventListener('close', () => {
        eventSource.close();
        setIsProcessing(false);
        // Don't clear processingReportName here - let LeappPage handle it
        // after the real report appears to avoid flicker
      });

      eventSource.onerror = () => {
        eventSource.close();
        setIsProcessing(false);
        setProcessingReportName(null);
        setLogs((prev) => [...prev, 'Error: Connection to server lost']);
      };
    } catch (error) {
      setIsProcessing(false);
      setProcessingReportName(null);
      setLogs((prev) => [...prev, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setProgress({ current: 0, total: 0 });
  };

  const clearProcessingReportName = () => {
    setProcessingReportName(null);
  };

  const stopProcessing = async () => {
    if (!taskId) return;

    try {
      await api.processing.stop(taskId);
      setIsProcessing(false);
      setProcessingReportName(null);
      setLogs((prev) => [...prev, 'Processing stopped by user']);
    } catch (error) {
      console.error('Failed to stop processing:', error);
    }
  };

  return (
    <ProcessingContext.Provider
      value={{
        logs,
        isProcessing,
        progress,
        taskId,
        processingReportName,
        startProcessing,
        stopProcessing,
        clearLogs,
        clearProcessingReportName,
        tool,
        encryptionDetected,
      }}
    >
      {children}
    </ProcessingContext.Provider>
  );
}

export function useProcessing() {
  const context = useContext(ProcessingContext);
  if (context === undefined) {
    throw new Error('useProcessing must be used within a ProcessingProvider');
  }
  return context;
}