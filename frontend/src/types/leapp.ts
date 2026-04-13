export interface Module {
    name: string;
    display_name: string;
    module_name: string;
    category: string;
    selected?: boolean;
}

export interface Profile {
    id: number;
    name: string;
    modules: string[];
    tool: string;
    created_at: string;
    updated_at: string;
}
