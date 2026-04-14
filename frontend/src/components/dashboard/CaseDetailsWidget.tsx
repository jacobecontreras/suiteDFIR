
import { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/Card"
import { cn } from "@/lib/utils"
import { useCase } from "@/context/CaseContext"
import { API } from "@/lib/api"
import { User, Phone, Mail, FileText, Info, ShieldAlert, Activity } from 'lucide-react'

import { Edit2 } from 'lucide-react'
import { CaseFormDialog } from "@/components/cases/CaseFormDialog"
import type { Case } from '@/types/case'

export default function CaseDetailsWidget({ className }: { className?: string }) {
    const { selectedCaseId, cases } = useCase()
    const [caseData, setCaseData] = useState<Case | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)

    const fetchCaseDetails = useCallback(async () => {
        setIsLoading(true)
        try {
            const res = await fetch(API.path(`/cases/${selectedCaseId}`))
            if (res.ok) {
                const data = await res.json()
                setCaseData(data)
            }
        } catch (error) {
            console.error('Failed to fetch case details:', error)
        } finally {
            setIsLoading(false)
        }
    }, [selectedCaseId])

    useEffect(() => {
        if (selectedCaseId) {
            fetchCaseDetails()
        } else {
            setCaseData(null)
        }
    }, [selectedCaseId, fetchCaseDetails])

    const handleCaseSaved = (savedCase: Case) => {
        setCaseData(savedCase)
    }

    if (!selectedCaseId) {
        return (
            <Card className={cn("bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full", className)}>
                <CardContent className="flex items-center justify-center h-full text-gray-500">
                    <p className="text-sm">No case selected</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className={cn("bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full", className)}>
            <div className="px-0 h-10 bg-transparent flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-2">
                        <FileText size={14} className="text-gray-400/70" />
                        Case Overview
                    </h3>
                    {caseData && !isLoading && (
                        <button
                            onClick={() => setIsEditModalOpen(true)}
                            className="p-1 hover:bg-[#333333] rounded text-gray-500 hover:text-white transition-colors"
                            title="Edit Case"
                        >
                            <Edit2 size={12} />
                        </button>
                    )}
                </div>
                {caseData && !isLoading && (
                    <span className="text-[10px] font-mono text-gray-500">{caseData.case_number}</span>
                )}
            </div>
            <CardContent className="flex-1 p-0 pt-0 flex flex-col min-h-0 gap-4">
                {isLoading || !caseData ? (
                    <div className="flex items-center justify-center h-full text-gray-500">
                        <p className="text-sm">{isLoading ? "Loading..." : "Case not found"}</p>
                    </div>
                ) : (
                    <>
                        {/* Top 60% - Details Grid */}
                        <div className="flex-[6] min-h-0 overflow-y-auto pr-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] flex flex-col justify-center">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                                {/* Case Name */}
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 text-gray-500 mb-0.5">
                                        <FileText size={12} />
                                        <span className="text-[9px] font-medium uppercase tracking-wider">Case Name</span>
                                    </div>
                                    <p className="text-sm text-gray-200 font-medium truncate">{caseData.name}</p>
                                </div>

                                {/* Client Name */}
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 text-gray-500 mb-0.5">
                                        <User size={12} />
                                        <span className="text-[9px] font-medium uppercase tracking-wider">Client Name</span>
                                    </div>
                                    <p className="text-sm text-gray-200 font-medium truncate">{caseData.client_name || ''}</p>
                                </div>

                                {/* Client Email */}
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 text-gray-500 mb-0.5">
                                        <Mail size={12} />
                                        <span className="text-[9px] font-medium uppercase tracking-wider">Client Email</span>
                                    </div>
                                    <p className="text-sm text-gray-200 font-medium truncate">{caseData.client_email || ''}</p>
                                </div>

                                {/* Client Phone */}
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 text-gray-500 mb-0.5">
                                        <Phone size={12} />
                                        <span className="text-[9px] font-medium uppercase tracking-wider">Client Phone</span>
                                    </div>
                                    <p className="text-sm text-gray-200 font-medium truncate">{caseData.client_phone || ''}</p>
                                </div>

                                {/* Status */}
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 text-gray-500 mb-0.5">
                                        <Activity size={12} />
                                        <span className="text-[9px] font-medium uppercase tracking-wider">Status</span>
                                    </div>
                                    <p className="text-sm text-gray-200 font-medium truncate">{caseData.status || 'Active'}</p>
                                </div>

                                {/* Priority */}
                                <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 text-gray-500 mb-0.5">
                                        <ShieldAlert size={12} />
                                        <span className="text-[9px] font-medium uppercase tracking-wider">Priority</span>
                                    </div>
                                    <p className="text-sm text-gray-200 font-medium truncate">{caseData.priority || 'Medium'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Bottom 40% - Case Description */}
                        <div className="flex-[4] flex flex-col min-h-0">
                            <div className="flex items-center gap-2 text-gray-500 shrink-0 mb-2">
                                <Info size={12} />
                                <span className="text-[9px] font-medium uppercase tracking-wider">Case Description</span>
                            </div>
                            <div className="flex-1 bg-[#1f1f1f]/50 border border-[#333333]/20 rounded-md p-3 overflow-y-auto text-xs text-gray-400 leading-relaxed [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                <p>{caseData.description || 'No description provided.'}</p>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>

            {caseData && (
                <CaseFormDialog
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    caseData={caseData}
                    existingNames={cases.map((c: any) => c.name)}
                    onSuccess={handleCaseSaved}
                />
            )}
        </Card>
    )
}
