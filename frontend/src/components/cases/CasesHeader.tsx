import { Plus } from "lucide-react"
import { Button } from "@/components/ui/Button"

interface CasesHeaderProps {
    onOpenCreate: () => void
}

export function CasesHeader({ onOpenCreate }: CasesHeaderProps) {
    return (
        <div className="px-8 py-6 bg-[#151515] flex justify-between items-center shrink-0">
            <div className="flex flex-col">
                <div className="font-['Oswald'] text-4xl font-bold tracking-wide text-white leading-none">
                    suiteDFIR
                </div>
                <div className="mt-1 text-xs uppercase tracking-[0.28em] text-gray-500">
                    Digital Forensics Toolkit
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button
                    size="sm"
                    onClick={onOpenCreate}
                    className="bg-white text-black hover:bg-gray-200 gap-1.5 text-[11px] font-bold uppercase tracking-wider h-8 px-3"
                >
                    <Plus size={14} />
                    New Case
                </Button>
            </div>
        </div>
    )
}
