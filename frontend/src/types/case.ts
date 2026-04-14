export type CaseStatus = 'Active' | 'Closed' | 'Archived'
export type CasePriority = 'High' | 'Medium' | 'Low'

export interface Case {
    id: number
    case_number: string
    name: string
    client_name: string
    client_phone: string
    client_email: string
    description: string
    status: CaseStatus
    priority: CasePriority
    created_at: string
    last_visited_at?: string
}
