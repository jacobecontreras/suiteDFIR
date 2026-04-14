export interface Report {
    id: number;
    name: string;
    path: string;
    url: string;
    tool: 'ileapp' | 'aleapp';
    created_at: string;
    size: string;
    artifact_count: number;
}
