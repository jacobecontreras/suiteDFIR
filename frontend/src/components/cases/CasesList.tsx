import { Trash2, Edit2 } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Case } from '@/types/case'

interface CasesListProps {
    cases: Case[]
    onSelectCase: (caseId: number) => void
    onOpenEdit: (e: React.MouseEvent, caseItem: Case) => void
    onDelete: (e: React.MouseEvent, caseItem: Case) => void
    getStatusColor: (status: string) => string
    getPriorityColor: (priority: string) => string
}

export function CasesList({
    cases,
    onSelectCase,
    onOpenEdit,
    onDelete,
    getStatusColor,
    getPriorityColor
}: CasesListProps) {
    return (
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
                        {cases.map(caseItem => (
                            <tr
                                key={caseItem.id}
                                onClick={() => onSelectCase(caseItem.id)}
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
                                            onClick={(e) => onOpenEdit(e, caseItem)}
                                            className="p-1.5 hover:bg-[#333333] rounded text-gray-500 hover:text-white transition-colors"
                                            title="Edit Case"
                                        >
                                            <Edit2 size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => onDelete(e, caseItem)}
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
    )
}
