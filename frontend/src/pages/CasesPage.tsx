import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useCase } from "@/context/CaseContext"
import { API } from "@/lib/api"
import { LoadingPage } from "@/components/ui/LoadingPage"
import { CasesHeader } from "@/components/cases/CasesHeader"
import { CasesFilters } from "@/components/cases/CasesFilters"
import { CasesGrid } from "@/components/cases/CasesGrid"
import { CasesList } from "@/components/cases/CasesList"
import { CaseFormDialog } from "@/components/cases/CaseFormDialog"
import type { Case, CaseStatus } from '@/types/case'
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { useConfirmDialog } from "@/hooks/useConfirmDialog"

export default function CasesPage() {
    const navigate = useNavigate()
    const { setSelectedCaseId, cases, setCases } = useCase()
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list')
    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState<CaseStatus | 'All'>('All')
    const [isLoading, setIsLoading] = useState(true)

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingCase, setEditingCase] = useState<Case | null>(null)
    const { config: deleteConfig, show: showDelete, hide: hideDelete, handleConfirm: handleDeleteConfirm } = useConfirmDialog()

    // --- Fetch Data ---
    useEffect(() => {
        fetchCases()
    }, [])

    const fetchCases = async () => {
        try {
            const res = await fetch(API.path('/cases'))
            if (res.ok) {
                const data = await res.json()
                setCases(data)
            }
        } catch (error) {
            console.error('Failed to fetch cases:', error)
        } finally {
            setIsLoading(false)
        }
    }

    // --- Derived State ---
    const filteredCases = cases.filter(c => {
        const matchesSearch =
            (c.name?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (c.case_number?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
            (c.client_name?.toLowerCase() || '').includes(searchQuery.toLowerCase())

        const matchesStatus = statusFilter === 'All' || c.status === statusFilter

        return matchesSearch && matchesStatus
    })

    // --- Handlers ---
    const handleSelectCase = async (caseId: number) => {
        // Track the visit on the backend
        try {
            await fetch(API.path(`/cases/${caseId}/visit`), { method: 'POST' })
        } catch (err) {
            console.error('Failed to track case visit:', err)
        }

        setSelectedCaseId(caseId.toString())
        navigate('/dashboard')
    }

    const handleOpenCreate = () => {
        setEditingCase(null)
        setIsModalOpen(true)
    }

    const handleOpenEdit = (e: React.MouseEvent, caseItem: Case) => {
        e.stopPropagation() // Prevent case selection
        setEditingCase(caseItem)
        setIsModalOpen(true)
    }

    const handleDelete = (e: React.MouseEvent, caseItem: Case) => {
        e.stopPropagation() // Prevent case selection
        showDelete({
            title: 'Delete Case',
            message: `Are you sure you want to delete case ${caseItem.name}? This action cannot be undone.`,
            variant: 'destructive',
            confirmLabel: 'Delete',
            onConfirm: () => executeDelete(caseItem.id)
        })
    }

    const executeDelete = async (caseId: number) => {
        try {
            const res = await fetch(API.path(`/cases/${caseId}`), {
                method: 'DELETE'
            })
            if (res.ok) {
                setCases(prev => prev.filter(c => c.id !== caseId))
            }
        } catch (error) {
            console.error('Failed to delete case:', error)
        }
    }

    const handleCaseSaved = (savedCase: Case) => {
        setCases(prev => {
            const exists = prev.find(c => c.id === savedCase.id)
            if (exists) {
                return prev.map(c => c.id === savedCase.id ? savedCase : c)
            } else {
                return [savedCase, ...prev]
            }
        })
    }

    // --- Helpers ---
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Active': return 'bg-white/10 text-white/80 border-white/20'
            case 'Closed': return 'bg-white/5 text-white/50 border-white/10'
            case 'Archived': return 'bg-white/5 text-white/30 border-white/5'
            default: return 'bg-white/5 text-white/20 border-white/5'
        }
    }

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'High': return 'text-white/80'
            case 'Medium': return 'text-white/50'
            case 'Low': return 'text-white/30'
            default: return 'text-white/20'
        }
    }

    return (
        <div className="h-full flex flex-col bg-[#151515] text-white overflow-hidden">
            <CasesHeader onOpenCreate={handleOpenCreate} />

            <CasesFilters
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
            />

            {/* Content Area */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {isLoading ? (
                    <LoadingPage />
                ) : filteredCases.length === 0 ? (
                    <div className="flex-1 min-h-[400px] flex flex-col items-center justify-center text-gray-500">
                        <p className="text-xl font-medium text-gray-400">No cases found</p>
                        <p className="text-sm text-gray-600 mt-2">Try adjusting your search or filters</p>
                    </div>
                ) : viewMode === 'grid' ? (
                    <CasesGrid
                        cases={filteredCases}
                        onSelectCase={handleSelectCase}
                        onOpenEdit={handleOpenEdit}
                        onDelete={handleDelete}
                        getStatusColor={getStatusColor}
                        getPriorityColor={getPriorityColor}
                    />
                ) : (
                    <CasesList
                        cases={filteredCases}
                        onSelectCase={handleSelectCase}
                        onOpenEdit={handleOpenEdit}
                        onDelete={handleDelete}
                        getStatusColor={getStatusColor}
                        getPriorityColor={getPriorityColor}
                    />
                )}
            </div>

            {/* Case Form Modal */}
            <CaseFormDialog
                open={isModalOpen}
                onOpenChange={(open: boolean) => setIsModalOpen(open)}
                caseData={editingCase}
                onSuccess={handleCaseSaved}
                existingNames={cases.map(c => c.name)}
            />

            {/* Delete Confirmation Modal */}
            <ConfirmDialog
                config={deleteConfig}
                onClose={hideDelete}
                onConfirm={handleDeleteConfirm}
            />
        </div>
    )
}
