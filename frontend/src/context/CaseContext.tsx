import { createContext, useContext, useState, useEffect, Dispatch, SetStateAction, ReactNode } from 'react'
import type { Case } from '@/types/case'
import { API } from '@/lib/api'

interface CaseContextType {
    selectedCaseId: string | null
    setSelectedCaseId: (id: string | null) => void
    cases: Case[]
    setCases: Dispatch<SetStateAction<Case[]>>
}

const CaseContext = createContext<CaseContextType | undefined>(undefined)

import { usePersistedState } from '@/hooks/usePersistedState';

export function CaseProvider({ children }: { children: ReactNode }) {
    const [selectedCaseId, setSelectedCaseId] = usePersistedState<string | null>(
        'selectedCaseId',
        null,
        typeof window !== 'undefined' ? localStorage : null
    );
    const [cases, setCases] = useState<Case[]>([])

    useEffect(() => {
        let isMounted = true

        const fetchCases = async () => {
            try {
                const res = await fetch(API.path('/cases'))
                if (!res.ok) return

                const data = await res.json()
                if (isMounted) {
                    setCases(data)
                }
            } catch (error) {
                console.error('Failed to fetch cases:', error)
            }
        }

        fetchCases()

        return () => {
            isMounted = false
        }
    }, [])

    return (
        <CaseContext.Provider value={{ selectedCaseId, setSelectedCaseId, cases, setCases }}>
            {children}
        </CaseContext.Provider>
    )
}

export function useCase() {
    const context = useContext(CaseContext)
    if (context === undefined) {
        throw new Error('useCase must be used within a CaseProvider')
    }
    return context
}
