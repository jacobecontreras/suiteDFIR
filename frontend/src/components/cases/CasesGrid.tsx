import { Calendar, Trash2, Edit2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/Card"
import { cn } from "@/lib/utils"
import { Case } from "@/components/cases/CaseFormDialog"

interface CasesGridProps {
    cases: Case[]
    onSelectCase: (caseId: number) => void
    onOpenEdit: (e: React.MouseEvent, caseItem: Case) => void
    onDelete: (e: React.MouseEvent, caseItem: Case) => void
    getStatusColor: (status: string) => string
    getPriorityColor: (priority: string) => string
}

export function CasesGrid({
    cases,
    onSelectCase,
    onOpenEdit,
    onDelete,
    getStatusColor,
    getPriorityColor
}: CasesGridProps) {
    return (
        <div className="flex-1 overflow-y-auto p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 auto-rows-max">
            {cases.map(caseItem => (
                <Card
                    key={caseItem.id}
                    onClick={() => onSelectCase(caseItem.id)}
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
                                    onClick={(e) => onOpenEdit(e, caseItem)}
                                    className="p-1 hover:bg-[#333333] rounded text-gray-500 hover:text-white transition-colors"
                                    title="Edit Case"
                                >
                                    <Edit2 size={14} />
                                </button>
                                <button
                                    onClick={(e) => onDelete(e, caseItem)}
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
    )
}
