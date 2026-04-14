export interface Device {
    udid: string
    name: string
    type: string
    is_encrypted?: boolean
    is_rooted?: boolean
}

export interface Backup {
    id: number
    name: string
    device_udid?: string
    device_name: string
    path: string
    created_at: string
    status?: string
    size?: string
    progress?: number
    type: string
}
