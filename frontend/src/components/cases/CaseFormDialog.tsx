
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { cn } from "@/lib/utils"
import { API } from "@/lib/api"
import { getUniqueName } from "@/lib/naming"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/Dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/Select"

// --- Types ---
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

interface CaseFormDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    caseData?: Case | null
    onSuccess: (savedCase: Case) => void
    existingNames: string[]
}

const Label = ({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
    <label className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)} {...props} />
)

export function CaseFormDialog({ open, onOpenChange, caseData, onSuccess, existingNames }: CaseFormDialogProps) {
    const [formData, setFormData] = useState<Partial<Case>>({})
    const [errors, setErrors] = useState<Record<string, string>>({})

    useEffect(() => {
        if (open) {
            if (caseData) {
                setFormData({ ...caseData }) // eslint-disable-line react-hooks/set-state-in-effect
            } else {
                setFormData({
                    status: 'Active',
                    priority: 'Medium',
                    case_number: `${new Date().getFullYear()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}` // Auto-gen
                })
            }
            setErrors({})
        }
    }, [open, caseData])

    const formatPhoneNumber = (value: string) => {
        if (!value) return value
        const phoneNumber = value.replace(/[^\d]/g, '')
        const phoneNumberLength = phoneNumber.length
        if (phoneNumberLength < 4) return phoneNumber
        if (phoneNumberLength < 7) {
            return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3)}`
        }
        return `(${phoneNumber.slice(0, 3)}) ${phoneNumber.slice(3, 6)}-${phoneNumber.slice(6, 10)}`
    }

    const validateEmail = (email: string) => {
        return String(email)
            .toLowerCase()
            .match(
                /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
            )
    }

    const handleSubmit = async () => {
        // Validation
        const newErrors: Record<string, string> = {}

        if (!formData.name?.trim()) {
            newErrors.name = 'Case name is required'
        }

        if (formData.client_email && !validateEmail(formData.client_email)) {
            newErrors.client_email = 'Invalid email address'
        }

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors)
            return
        }

        try {
            if (caseData) {
                // Update
                const res = await fetch(API.path(`/cases/${caseData.id}`), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                })
                if (res.ok) {
                    const updatedCase = await res.json()
                    onSuccess(updatedCase)
                    onOpenChange(false)
                }
            } else {
                // Create
                const uniqueName = getUniqueName(formData.name!, existingNames)
                const payload = { ...formData, name: uniqueName }

                const res = await fetch(API.path('/cases'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                if (res.ok) {
                    const newCase = await res.json()
                    onSuccess(newCase)
                    onOpenChange(false)
                }
            }
        } catch (error) {
            console.error('Failed to save case:', error)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[480px] bg-[#151515] border-[#333333] p-6">
                <DialogHeader className="mb-2">
                    <DialogTitle className="text-white text-lg font-semibold">
                        {caseData ? 'Edit Case' : 'Create New Case'}
                    </DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {/* Case ID */}
                    <div className="space-y-1">
                        <Label htmlFor="case_id" className="text-gray-500 text-[10px] uppercase tracking-wider">Case ID</Label>
                        <Input
                            id="case_id"
                            placeholder="Generate automatically"
                            value={formData.case_number || ''}
                            onChange={e => setFormData({ ...formData, case_number: e.target.value })}
                            className="bg-[#111111] border-[#333333] h-8 text-xs focus-visible:ring-0 focus-visible:border-gray-500 transition-colors"
                        />
                    </div>

                    {/* Case Name */}
                    <div className="space-y-1">
                        <Label htmlFor="name" className="text-gray-500 text-[10px] uppercase tracking-wider">Case Name</Label>
                        <Input
                            id="name"
                            value={formData.name || ''}
                            onChange={e => {
                                setFormData({ ...formData, name: e.target.value })
                                if (errors.name) setErrors({ ...errors, name: '' })
                            }}
                            className={cn(
                                "bg-[#111111] border-[#333333] h-8 text-xs focus-visible:ring-0 transition-colors",
                                errors.name ? "border-red-500/50" : "focus-visible:border-gray-500"
                            )}
                        />
                    </div>

                    {/* Client Name */}
                    <div className="col-span-2 space-y-1">
                        <Label htmlFor="client" className="text-gray-500 text-[10px] uppercase tracking-wider">Client Name</Label>
                        <Input
                            id="client"
                            value={formData.client_name || ''}
                            onChange={e => setFormData({ ...formData, client_name: e.target.value })}
                            className="bg-[#111111] border-[#333333] h-8 text-xs focus-visible:ring-0 focus-visible:border-gray-500 transition-colors"
                        />
                    </div>

                    {/* Client Phone */}
                    <div className="space-y-1">
                        <Label htmlFor="phone" className="text-gray-500 text-[10px] uppercase tracking-wider">Client Phone</Label>
                        <Input
                            id="phone"
                            value={formData.client_phone || ''}
                            onChange={e => {
                                const formatted = formatPhoneNumber(e.target.value)
                                setFormData({ ...formData, client_phone: formatted })
                            }}
                            placeholder="(555) 555-5555"
                            className="bg-[#111111] border-[#333333] h-8 text-xs focus-visible:ring-0 focus-visible:border-gray-500 transition-colors"
                        />
                    </div>

                    {/* Client Email */}
                    <div className="space-y-1">
                        <Label htmlFor="email" className="text-gray-500 text-[10px] uppercase tracking-wider">Client Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={formData.client_email || ''}
                            onChange={e => setFormData({ ...formData, client_email: e.target.value })}
                            placeholder="client@example.com"
                            className={cn(
                                "bg-[#111111] border-[#333333] h-8 text-xs focus-visible:ring-0 transition-colors",
                                errors.client_email ? "border-red-500" : "focus-visible:border-gray-500"
                            )}
                        />
                    </div>

                    {/* Status */}
                    <div className="space-y-1">
                        <Label htmlFor="status" className="text-gray-500 text-[10px] uppercase tracking-wider">Status</Label>
                        <Select
                            value={formData.status || 'Active'}
                            onValueChange={(val) => setFormData({ ...formData, status: val as CaseStatus })}
                        >
                            <SelectTrigger id="status" className="bg-[#111111] border-[#333333] h-8 text-xs focus:ring-0 focus:border-gray-500 transition-colors justify-center gap-2">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1A1A1A] border-[#333333] text-white">
                                <SelectItem value="Active">Active</SelectItem>
                                <SelectItem value="Closed">Closed</SelectItem>
                                <SelectItem value="Archived">Archived</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Priority */}
                    <div className="space-y-1">
                        <Label htmlFor="priority" className="text-gray-500 text-[10px] uppercase tracking-wider">Priority</Label>
                        <Select
                            value={formData.priority || 'Medium'}
                            onValueChange={(val) => setFormData({ ...formData, priority: val as CasePriority })}
                        >
                            <SelectTrigger id="priority" className="bg-[#111111] border-[#333333] h-8 text-xs focus:ring-0 focus:border-gray-500 transition-colors justify-center gap-2">
                                <SelectValue placeholder="Priority" />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1A1A1A] border-[#333333] text-white">
                                <SelectItem value="High">High</SelectItem>
                                <SelectItem value="Medium">Medium</SelectItem>
                                <SelectItem value="Low">Low</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Description */}
                    <div className="col-span-2 space-y-1">
                        <Label htmlFor="description" className="text-gray-500 text-[10px] uppercase tracking-wider">Case Description</Label>
                        <textarea
                            id="description"
                            className="w-full bg-[#1f1f1f] border border-[#333333]/50 rounded-md p-2 text-xs text-gray-200 outline-none focus:ring-0 transition-colors min-h-[120px] resize-none"
                            value={formData.description || ''}
                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                        />
                    </div>
                </div>

                <DialogFooter className="mt-4 gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="text-gray-400 hover:text-white hover:bg-[#222222] h-8 text-xs px-4"
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        className="bg-white text-black hover:bg-gray-200 h-8 text-xs px-6 font-semibold"
                    >
                        {caseData ? 'Save Changes' : 'Create Case'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
