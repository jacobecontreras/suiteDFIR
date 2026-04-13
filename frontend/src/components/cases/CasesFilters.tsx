import { Search, LayoutGrid, List as ListIcon } from "lucide-react"
import { Input } from "@/components/ui/Input"
import { cn } from "@/lib/utils"
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem
} from "@/components/ui/Select"
import { CaseStatus } from "@/components/cases/CaseFormDialog"

interface CasesFiltersProps {
    searchQuery: string
    onSearchChange: (value: string) => void
    statusFilter: CaseStatus | 'All'
    onStatusFilterChange: (value: CaseStatus | 'All') => void
    viewMode: 'grid' | 'list'
    onViewModeChange: (mode: 'grid' | 'list') => void
}

export function CasesFilters({
    searchQuery,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    viewMode,
    onViewModeChange
}: CasesFiltersProps) {
    return (
        <div className="px-8 py-4 bg-[#151515] flex gap-4 items-center shrink-0">
            <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                <Input
                    placeholder="Search..."
                    className="pl-9 bg-[#1A1A1A] border-[#333333] text-white placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-gray-500"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </div>

            <div className="flex items-center gap-2 ml-auto">
                <Select value={statusFilter} onValueChange={(val) => onStatusFilterChange(val as CaseStatus | 'All')}>
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
                        onClick={() => onViewModeChange('list')}
                        className={cn(
                            "p-1.5 rounded transition-colors",
                            viewMode === 'list' ? "bg-[#333333] text-white" : "text-gray-500 hover:text-gray-300"
                        )}
                    >
                        <ListIcon size={16} />
                    </button>
                    <button
                        onClick={() => onViewModeChange('grid')}
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
    )
}
