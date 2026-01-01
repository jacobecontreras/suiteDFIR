import { Module, Profile } from '../app/(main)/ileapp/types';

const API_BASE = 'http://localhost:8000/api';

async function handleApiResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
    }
    return response.json();
}

/**
 * Create a tool-specific API client
 * @param tool - The tool identifier (e.g., 'ileapp', 'aleapp')
 */
export function createLeappApi(tool: string) {
    return {
        modules: {
            getAll: async (): Promise<{ modules: Module[] }> => {
                const response = await fetch(`${API_BASE}/profiles/modules?tool=${tool}`);
                return handleApiResponse(response);
            },

            select: async (selections: Record<string, boolean>): Promise<void> => {
                await fetch(`${API_BASE}/profiles/modules/select`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool, selections }),
                });
            },
        },

        profiles: {
            getAll: async (): Promise<Profile[]> => {
                const response = await fetch(`${API_BASE}/profiles?tool=${tool}`);
                return handleApiResponse(response);
            },

            load: async (profileId: number): Promise<{ message: string }> => {
                const response = await fetch(`${API_BASE}/profiles/${profileId}/load`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool }),
                });
                return handleApiResponse(response);
            },

            save: async (name: string, modules: string[]): Promise<{ name: string }> => {
                const response = await fetch(`${API_BASE}/profiles`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool, name, modules }),
                });
                return handleApiResponse(response);
            },

            delete: async (profileId: number): Promise<{ message: string }> => {
                const response = await fetch(`${API_BASE}/profiles/${profileId}`, {
                    method: 'DELETE',
                });
                return handleApiResponse(response);
            },
        },

        browser: {
            browseFiles: async (): Promise<{ success: boolean; file_path: string }> => {
                const response = await fetch(`${API_BASE}/browse-files`, { method: 'POST' });
                return handleApiResponse(response);
            },

            browseFolders: async (): Promise<{ success: boolean; file_path: string }> => {
                const response = await fetch(`${API_BASE}/browse-folders`, { method: 'POST' });
                return handleApiResponse(response);
            },
        },

        processing: {
            start: async (
                inputPath: string,
                outputFolder: string,
                selectedModules: string[],
                reportName?: string,
                password?: string,
                caseId?: number,
                timezone?: string
            ): Promise<{ task_id: string }> => {
                const response = await fetch(`${API_BASE}/process/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        tool: tool,
                        input_path: inputPath,
                        output_folder: outputFolder,
                        selected_modules: selectedModules,
                        report_name: reportName,
                        password: password,
                        case_name: reportName || `Case_${Date.now()}`, // Fallback if needed
                        case_id: caseId,
                        timezone: timezone
                    }),
                });
                return handleApiResponse(response);
            },

            stop: async (taskId: string): Promise<void> => {
                const response = await fetch(`${API_BASE}/process/stop`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskId }),
                });
                return handleApiResponse(response);
            },

            validateBackup: async (inputPath: string): Promise<{ encrypted: boolean, type: string, supported: boolean, message?: string }> => {
                const response = await fetch(`${API_BASE}/ios/validate-backup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input_path: inputPath }),
                });
                return handleApiResponse(response);
            },

            createEventSource: (taskId: string): EventSource => {
                return new EventSource(`${API_BASE}/process/stream/${taskId}`);
            },
        },
        backup: {
            getDevices: async () => {
                const response = await fetch(`${API_BASE}/ios/devices`);
                if (!response.ok) throw new Error('Failed to fetch devices');
                return response.json();
            },
            startBackup: async (udid: string, name: string, caseId?: number) => {
                const response = await fetch(`${API_BASE}/ios/backup`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ udid, name, case_id: caseId }),
                });
                if (!response.ok) throw new Error('Failed to start backup');
                return response.json();
            },
            getBackups: async (caseId?: number) => {
                const url = caseId ? `${API_BASE}/backups?case_id=${caseId}` : `${API_BASE}/backups`;
                const response = await fetch(url);
                if (!response.ok) throw new Error('Failed to fetch backups');
                return response.json();
            },
            deleteBackup: async (id: number) => {
                const response = await fetch(`${API_BASE}/backups/${id}`, {
                    method: 'DELETE',
                });
                if (!response.ok) throw new Error('Failed to delete backup');
                return response.json();
            },
        },
    };
}

// Keep backward compatibility - default to i LEAPP
export const ileappApi = createLeappApi('ileapp');
