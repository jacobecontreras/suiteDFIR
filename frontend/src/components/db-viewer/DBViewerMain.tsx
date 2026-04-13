import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { useDBViewer, TabType } from '@/context/DBViewerContext'
import { StructurePanel } from './StructurePanel'
import { BrowseDataPanel } from './BrowseDataPanel'
import { ExecuteSQLPanel } from './ExecuteSQLPanel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import type { DatabaseInfo } from '@/context/DBViewerContext'

interface DBViewerMainProps {
    availableDatabases: DatabaseInfo[]
    selectedDatabase: DatabaseInfo | null
    onDatabaseChange: (value: string) => void
}

export function DBViewerMain({ availableDatabases, selectedDatabase, onDatabaseChange }: DBViewerMainProps) {
    const { activeTab, setActiveTab } = useDBViewer()

    return (
        <Tabs value={activeTab} onValueChange={(v: string) => setActiveTab(v as TabType)} className="h-full flex flex-col">
            <div className="pb-3 flex items-center justify-between">
                {/* Database selector - now on left */}
                {availableDatabases.length > 0 && (
                    <Select
                        value={selectedDatabase?.relativePath || ''}
                        onValueChange={onDatabaseChange}
                    >
                        <SelectTrigger className="w-[360px] h-9 bg-[#2a2a2a] border border-white/10 text-white rounded-lg">
                            <SelectValue placeholder="Select database" />
                        </SelectTrigger>
                        <SelectContent
                            className="bg-[#2a2a2a] border border-white/10 rounded-lg"
                            searchable={true}
                            itemCount={availableDatabases.length}
                            align="start"
                        >
                            {availableDatabases.map((db) => (
                                <SelectItem
                                    key={db.relativePath}
                                    value={db.relativePath}
                                    filterText={db.relativePath}
                                    className="text-white rounded-md"
                                >
                                    <div className="flex flex-col">
                                        <span className="truncate font-medium">{db.name}</span>
                                        <span className="text-[#888] text-xs truncate">{db.relativePath}</span>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                {/* Tab switcher - now on right */}
                <TabsList className="h-9 bg-[#2a2a2a] border border-white/10 rounded-lg px-1.5 py-1.5 gap-1">
                    <TabsTrigger
                        value="structure"
                        className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-[#888] rounded-md px-4 py-1 text-sm font-medium transition-colors"
                    >
                        Structure
                    </TabsTrigger>
                    <TabsTrigger
                        value="browse"
                        className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-[#888] rounded-md px-4 py-1 text-sm font-medium transition-colors"
                    >
                        Browse Data
                    </TabsTrigger>
                    <TabsTrigger
                        value="execute"
                        className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-[#888] rounded-md px-4 py-1 text-sm font-medium transition-colors"
                    >
                        Execute SQL
                    </TabsTrigger>
                </TabsList>
            </div>

            <TabsContent value="structure" className="flex-1 min-h-0 m-0 p-0">
                <StructurePanel />
            </TabsContent>

            <TabsContent value="browse" className="flex-1 min-h-0 m-0 p-0">
                <BrowseDataPanel />
            </TabsContent>

            <TabsContent value="execute" className="flex-1 min-h-0 m-0 p-0">
                <ExecuteSQLPanel />
            </TabsContent>
        </Tabs>
    )
}

export default DBViewerMain
