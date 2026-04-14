import { Module, Profile } from '../types/leapp';
import { Device, Backup } from '../types/backup';
import { API } from '@/lib/api';

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
                const response = await fetch(API.path(`/profiles/modules?tool=${tool}`));
                return handleApiResponse(response);
            },

            select: async (selections: Record<string, boolean>): Promise<void> => {
                await fetch(API.path('/profiles/modules/select'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool, selections }),
                });
            },
        },

        profiles: {
            getAll: async (): Promise<Profile[]> => {
                const response = await fetch(API.path(`/profiles?tool=${tool}`));
                return handleApiResponse(response);
            },

            load: async (profile_id: number): Promise<{ message: string, modules: string[] }> => {
                const response = await fetch(API.path(`/profiles/${profile_id}/load`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool }),
                });
                return handleApiResponse(response);
            },

            save: async (name: string, modules: string[]): Promise<{ name: string }> => {
                const response = await fetch(API.path('/profiles'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool, name, modules }),
                });
                return handleApiResponse(response);
            },

            delete: async (profileId: number): Promise<{ message: string }> => {
                const response = await fetch(API.path(`/profiles/${profileId}`), {
                    method: 'DELETE',
                });
                return handleApiResponse(response);
            },
        },

        browser: {
            browseFiles: async (): Promise<{ success: boolean; file_path: string }> => {
                const response = await fetch(API.path('/browse-files'), { method: 'POST' });
                return handleApiResponse(response);
            },

            browseFolders: async (): Promise<{ success: boolean; file_path: string }> => {
                const response = await fetch(API.path('/browse-folders'), { method: 'POST' });
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
                caseId?: number
            ): Promise<{ task_id: string }> => {
                const response = await fetch(API.path('/process/start'), {
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
                        case_id: caseId
                    }),
                });
                return handleApiResponse(response);
            },

            stop: async (taskId: string): Promise<void> => {
                const response = await fetch(API.path('/process/stop'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskId }),
                });
                return handleApiResponse(response);
            },

            validateBackup: async (inputPath: string): Promise<{ encrypted: boolean; valid: boolean; error?: string }> => {
                const response = await fetch(API.path('/backups/validate'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input_path: inputPath }),
                });
                return handleApiResponse(response);
            },

            createEventSource: (taskId: string): EventSource => {
                return new EventSource(API.path(`/process/stream/${taskId}`));
            },
        },
        backup: {
            getDevices: async (): Promise<Device[]> => {
                const response = await fetch(API.path('/backups/devices'));
                return handleApiResponse<Device[]>(response);
            },
            startBackup: async (udid: string, name: string, caseId?: number, password?: string): Promise<{ backup_id: number }> => {
                const response = await fetch(API.path('/backups'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ udid, name, case_id: caseId, password }),
                });
                return handleApiResponse<{ backup_id: number }>(response);
            },
            getBackups: async (caseId?: number): Promise<Backup[]> => {
                const url = caseId ? API.path(`/backups?case_id=${caseId}`) : API.path('/backups');
                const response = await fetch(url);
                return handleApiResponse<Backup[]>(response);
            },
            deleteBackup: async (id: number): Promise<{ message: string }> => {
                const response = await fetch(API.path(`/backups/${id}`), {
                    method: 'DELETE',
                });
                return handleApiResponse<{ message: string }>(response);
            },
        },
    };
}
