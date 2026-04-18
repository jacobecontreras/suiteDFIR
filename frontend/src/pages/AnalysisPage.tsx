import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { cn } from '@/lib/utils'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui'
import LeappPage from '@/components/leapp/LeappPage'
import PhotogrepPage from '@/components/photogrep/PhotogrepPage'

type Platform = 'ios' | 'android'
type AnalysisTool = 'ileapp' | 'aleapp' | 'photogrep'

const IOS_TOOLS = [
    { value: 'ileapp', label: 'iLEAPP', description: 'Artifact Analysis' },
    { value: 'photogrep', label: 'photogrep', description: 'Photo Analysis' },
]

const ANDROID_TOOLS = [
    { value: 'aleapp', label: 'aLEAPP', description: 'Artifact Analysis' },
]

function isAnalysisTool(value: string | null): value is AnalysisTool {
    return value === 'ileapp' || value === 'aleapp' || value === 'photogrep'
}

function getPlatform(tool: AnalysisTool): Platform {
    return tool === 'aleapp' ? 'android' : 'ios'
}

export default function AnalysisPage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const requestedTool = searchParams.get('tool')
    const activeTool: AnalysisTool = isAnalysisTool(requestedTool) ? requestedTool : 'ileapp'
    const activePlatform = getPlatform(activeTool)
    const toolOptions = activePlatform === 'ios' ? IOS_TOOLS : ANDROID_TOOLS
    const currentTool = toolOptions.find(o => o.value === activeTool)

    useEffect(() => {
        if (!isAnalysisTool(requestedTool)) {
            setSearchParams({ tool: 'ileapp' }, { replace: true })
        }
    }, [requestedTool, setSearchParams])

    const toolSelector = (
        <div className="flex flex-col gap-3 -mb-2">
            <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Platform</label>
                <div className="h-9 w-full rounded-md border border-[#333333] bg-[#171717] p-1 flex gap-1">
                    {(['ios', 'android'] as const).map((platform) => {
                        const isActive = platform === activePlatform
                        const label = platform === 'ios' ? 'iOS' : 'Android'
                        return (
                            <button
                                key={platform}
                                onClick={() => setSearchParams({
                                    tool: platform === 'android' ? 'aleapp' : 'ileapp'
                                })}
                                className={cn(
                                    'h-full flex-1 text-xs font-medium uppercase tracking-wider rounded transition-colors',
                                    isActive
                                        ? 'bg-white text-black'
                                        : 'text-gray-400 hover:bg-white/5 hover:text-white'
                                )}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>
            </div>
            <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Tool</label>
                <Select value={activeTool} onValueChange={(val) => setSearchParams({ tool: val })}>
                    <SelectTrigger className="w-full h-9 text-xs bg-[#2a2a2a] border border-white/10 text-white rounded-lg">
                        <SelectValue>{currentTool?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" className="bg-[#2a2a2a] border border-white/10 rounded-lg max-w-none">
                        {toolOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value} className="text-white rounded-md">
                                {opt.label}
                                <span className="text-[#888] text-xs ml-2">{opt.description}</span>
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    )

    return (
        <div className="h-full flex flex-col bg-[#151515] text-white">
            {/* Tool Content */}
            <div className="flex-1 min-h-0 relative">
                <div className={cn('absolute inset-0', activeTool !== 'ileapp' && 'hidden')}>
                    <LeappPage tool="ileapp" toolName="iLEAPP" toolSelector={toolSelector} />
                </div>
                <div className={cn('absolute inset-0', activeTool !== 'aleapp' && 'hidden')}>
                    <LeappPage tool="aleapp" toolName="aLEAPP" toolSelector={toolSelector} />
                </div>
                <div className={cn('absolute inset-0', activeTool !== 'photogrep' && 'hidden')}>
                    <PhotogrepPage toolSelector={toolSelector} />
                </div>
            </div>
        </div>
    )
}
