import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useCase } from "@/context/CaseContext"
import { API } from "@/lib/api"
import {
    Search,
    LayoutGrid,
    List as ListIcon,
    Plus,
    Calendar,
    Trash2,
    Edit2,
} from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Card, CardContent } from "@/components/ui/Card"
import { LoadingPage } from "@/components/ui/LoadingPage"
import { cn } from "@/lib/utils"


import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem
} from "@/components/ui/Select"
import { CaseFormDialog, Case, CaseStatus } from "@/components/cases/CaseFormDialog"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/Dialog"

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
    const [caseToDelete, setCaseToDelete] = useState<Case | null>(null)

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
        setCaseToDelete(caseItem)
    }

    const executeDelete = async () => {
        if (!caseToDelete) return
        try {
            const res = await fetch(API.path(`/cases/${caseToDelete.id}`), {
                method: 'DELETE'
            })
            if (res.ok) {
                setCases(prev => prev.filter(c => c.id !== caseToDelete.id))
                setCaseToDelete(null)
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
            {/* Header */}
            <div className="px-8 py-6 bg-[#151515] flex justify-between items-center shrink-0">
                <div />

                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        onClick={handleOpenCreate}
                        className="bg-white text-black hover:bg-gray-200 gap-1.5 text-[11px] font-bold uppercase tracking-wider h-8 px-3"
                    >
                        <Plus size={14} />
                        New Case
                    </Button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="px-8 py-4 bg-[#151515] flex gap-4 items-center shrink-0">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                    <Input
                        placeholder="Search..."
                        className="pl-9 bg-[#1A1A1A] border-[#333333] text-white placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-gray-500"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                <div className="flex items-center gap-2 ml-auto">
                    <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as CaseStatus | 'All')}>
                        <SelectTrigger className="w-[130px] h-9 bg-[#1A1A1A] border-[#333333] text-gray-300 gap-2 px-3 focus:ring-0 focus:ring-offset-0 transition-colors focus:border-gray-500">
                            <SelectValue>
                                {statusFilter === 'All' ? 'All Status' : statusFilter}
                            </SelectValue>
                        </SelectTrigger>
                        <SelectContent className="bg-[#1A1A1A] border-[#333333] text-gray-300 max-h-[300px] overflow-y-auto">
                            <SelectItem value="All">All Status</SelectItem>
                            <SelectItem value="Active">Active</SelectItem>
                            <SelectItem value="Closed">Closed</SelectItem>
                            <SelectItem value="Archived">Archived</SelectItem>
                        </SelectContent>
                    </Select>

                    <div className="h-9 w-[1px] bg-[#333333] mx-2" />

                    <div className="flex bg-[#1A1A1A] rounded-md border border-[#333333] p-1">
                        <button
                            onClick={() => setViewMode('list')}
                            className={cn(
                                "p-1.5 rounded transition-colors",
                                viewMode === 'list' ? "bg-[#333333] text-white" : "text-gray-500 hover:text-gray-300"
                            )}
                        >
                            <ListIcon size={16} />
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                "p-1.5 rounded transition-colors",
                                viewMode === 'grid' ? "bg-[#333333] text-white" : "text-gray-500 hover:text-gray-300"
                            )}
                        >
                            <LayoutGrid size={16} />
                        </button>
                    </div>
                </div>
            </div>

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
                    // Grid View
                    <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 auto-rows-max">
                        {filteredCases.map(caseItem => (
                            <Card
                                key={caseItem.id}
                                onClick={() => handleSelectCase(caseItem.id)}
                                className="bg-[#1A1A1A] border-[#333333] hover:border-[#555555] transition-all cursor-pointer group flex flex-col hover:shadow-lg hover:bg-[#1E1E1E]"
                            >
                                <CardContent className="p-5 flex-1 flex flex-col">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="space-y-1">
                                            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
                                                {caseItem.case_number}
                                            </span>
                                            <h3 className="font-semibold text-gray-200 group-hover:text-white transition-colors line-clamp-1" title={caseItem.name}>
                                                {caseItem.name}
                                            </h3>
                                        </div>
                                        <div className={cn("px-2 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider", getStatusColor(caseItem.status))}>
                                            {caseItem.status}
                                        </div>
                                    </div>

                                    <div className="space-y-2 flex-1 pt-2">
                                        <div className="text-sm text-gray-400">
                                            <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-0.5">Contact</span>
                                            <span className="truncate block font-medium text-gray-300">{caseItem.client_name || ''}</span>
                                        </div>
                                        <div className="text-xs text-gray-500 space-y-0.5">
                                            <div className="truncate">{caseItem.client_email || ''}</div>
                                            <div className="truncate">{caseItem.client_phone || ''}</div>
                                        </div>
                                    </div>

                                    <div className="mt-5 pt-4 border-t border-[#222222] flex justify-between items-center">
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <Calendar size={12} />
                                            <span>{new Date(caseItem.created_at).toLocaleDateString()}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className={cn("text-[10px] font-bold uppercase tracking-wider mr-2", getPriorityColor(caseItem.priority))}>
                                                {caseItem.priority}
                                            </span>
                                            <button
                                                onClick={(e) => handleOpenEdit(e, caseItem)}
                                                className="p-1 hover:bg-[#333333] rounded text-gray-500 hover:text-white transition-colors"
                                                title="Edit Case"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => handleDelete(e, caseItem)}
                                                className="p-1 hover:bg-[#333333] rounded text-gray-500 hover:text-red-400 transition-colors"
                                                title="Delete Case"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                ) : (
                    // List View
                    <div className="p-8 pb-12 flex-1 min-h-0">
                        <div className="border border-[#333333] rounded-lg bg-[#1A1A1A] max-h-full overflow-y-auto relative">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead className="bg-[#1A1A1A] text-gray-400 text-[10px] uppercase tracking-wider font-semibold border-b border-[#333333] sticky top-0 z-20">
                                    <tr>
                                        <th className="px-6 py-3 w-[120px] bg-[#1A1A1A]">Case ID</th>
                                        <th className="px-6 py-3 bg-[#1A1A1A]">Case Name</th>
                                        <th className="px-6 py-3 bg-[#1A1A1A]">Client Contact</th>
                                        <th className="px-6 py-3 w-[120px] bg-[#1A1A1A]">Status</th>
                                        <th className="px-6 py-3 w-[120px] bg-[#1A1A1A]">Priority</th>
                                        <th className="px-6 py-3 w-[120px] bg-[#1A1A1A]">Date</th>
                                        <th className="px-6 py-3 w-[50px] bg-[#1A1A1A]"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#222222]">
                                    {filteredCases.map(caseItem => (
                                        <tr
                                            key={caseItem.id}
                                            onClick={() => handleSelectCase(caseItem.id)}
                                            className="hover:bg-[#1F1F1F] transition-colors group cursor-pointer"
                                        >
                                            <td className="px-6 py-4 font-mono text-gray-500 text-xs">{caseItem.case_number}</td>
                                            <td className="px-6 py-4 font-medium text-gray-200">{caseItem.name}</td>
                                            <td className="px-6 py-4 text-gray-400">
                                                <div className="flex flex-col">
                                                    <span className="text-gray-300 font-medium">{caseItem.client_name || ''}</span>
                                                    <span className="text-[10px] text-gray-500">
                                                        {[caseItem.client_email, caseItem.client_phone].filter(Boolean).join(' / ')}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn("px-2 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider inline-block", getStatusColor(caseItem.status))}>
                                                    {caseItem.status}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <span className={cn("text-[10px] font-bold uppercase tracking-wider", getPriorityColor(caseItem.priority))}>
                                                    {caseItem.priority}
                                                </span>
                                            </td>
                                            <td className="px-6 py-4 text-gray-500 text-xs">{new Date(caseItem.created_at).toLocaleDateString()}</td>
                                            <td className="px-6 py-4 text-right">
                                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={(e) => handleOpenEdit(e, caseItem)}
                                                        className="p-1.5 hover:bg-[#333333] rounded text-gray-500 hover:text-white transition-colors"
                                                        title="Edit Case"
                                                    >
                                                        <Edit2 size={14} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => handleDelete(e, caseItem)}
                                                        className="p-1.5 hover:bg-[#333333] rounded text-gray-500 hover:text-red-400 transition-colors"
                                                        title="Delete Case"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
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
            <Dialog open={caseToDelete !== null} onOpenChange={(open: boolean) => !open && setCaseToDelete(null)}>
                <DialogContent className="max-w-[340px] p-5 bg-[#1A1A1A] border-[#333333] rounded-xl shadow-2xl">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-semibold text-white tracking-wide uppercase">Delete Case</DialogTitle>
                    </DialogHeader>
                    <div className="py-2">
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                            Are you sure you want to delete case <span className="text-white font-medium">{caseToDelete?.name}</span>? This action cannot be undone.
                        </p>
                    </div>
                    <DialogFooter className="mt-2 flex gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            className="flex-1 h-8 text-[11px] bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                            onClick={() => setCaseToDelete(null)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="flex-1 h-8 text-[11px] bg-red-900/20 hover:bg-red-900/40 text-white border border-red-900/30"
                            onClick={executeDelete}
                        >
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
