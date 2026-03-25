import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import LeappPage from '@/components/leapp/LeappPage'

const ANALYSIS_TOOLS = ['ileapp', 'aleapp'] as const
type AnalysisTool = typeof ANALYSIS_TOOLS[number]

function isAnalysisTool(value: string | null): value is AnalysisTool {
    return value === 'ileapp' || value === 'aleapp'
}

function getAnalysisLabel(tool: AnalysisTool) {
    return tool === 'ileapp' ? 'iOS (iLEAPP)' : 'Android (aLEAPP)'
}

export default function AnalysisPage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const requestedTool = searchParams.get('tool')
    const activeTool: AnalysisTool = isAnalysisTool(requestedTool) ? requestedTool : 'ileapp'

    useEffect(() => {
        if (!isAnalysisTool(requestedTool)) {
            setSearchParams({ tool: 'ileapp' }, { replace: true })
        }
    }, [requestedTool, setSearchParams])

    return (
        <div className="h-full flex flex-col bg-[#151515] text-white">
            <div className="flex-1 min-h-0 relative">
                <div className={cn('absolute inset-0', activeTool !== 'ileapp' && 'hidden')}>
                    <LeappPage tool="ileapp" toolName="iLEAPP" actionSlot={
                        <div className="h-9 w-full rounded-md border border-[#333333] bg-[#171717] p-1 flex gap-1">
                            {ANALYSIS_TOOLS.map((tool) => {
                                const isActive = tool === activeTool
                                const label = getAnalysisLabel(tool)

                                return (
                                    <Button
                                        key={tool}
                                        variant="ghost"
                                        onClick={() => setSearchParams({ tool })}
                                            className={cn(
                                                'h-full flex-1 px-4 text-xs font-medium uppercase tracking-wider',
                                                isActive
                                                ? 'bg-white text-black hover:bg-white hover:text-black dark:hover:bg-white dark:hover:text-black'
                                                : 'text-gray-400 hover:bg-white/5 hover:text-white'
                                            )}
                                        >
                                        {label}
                                    </Button>
                                )
                            })}
                        </div>
                    } />
                </div>
                <div className={cn('absolute inset-0', activeTool !== 'aleapp' && 'hidden')}>
                    <LeappPage tool="aleapp" toolName="aLEAPP" actionSlot={
                        <div className="h-9 w-full rounded-md border border-[#333333] bg-[#171717] p-1 flex gap-1">
                            {ANALYSIS_TOOLS.map((tool) => {
                                const isActive = tool === activeTool
                                const label = getAnalysisLabel(tool)

                                return (
                                    <Button
                                        key={tool}
                                        variant="ghost"
                                        onClick={() => setSearchParams({ tool })}
                                            className={cn(
                                                'h-full flex-1 px-4 text-xs font-medium uppercase tracking-wider',
                                                isActive
                                                ? 'bg-white text-black hover:bg-white hover:text-black dark:hover:bg-white dark:hover:text-black'
                                                : 'text-gray-400 hover:bg-white/5 hover:text-white'
                                            )}
                                        >
                                        {label}
                                    </Button>
                                )
                            })}
                        </div>
                    } />
                </div>
            </div>
        </div>
    )
}
