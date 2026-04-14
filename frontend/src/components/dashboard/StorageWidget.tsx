
import { useState, useEffect } from 'react'
import { Card, CardContent } from "@/components/ui/Card"
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Database } from 'lucide-react'
import { useCase } from "@/context/CaseContext"
import { API } from "@/lib/api"
import { formatBytes } from "@/lib/spatialLimits"

interface StorageData {
    total: number
    free: number
    breakdown: {
        name: string
        value: number
        color: string
    }[]
}

interface StorageWidgetProps {
    className?: string
}

export default function StorageWidget({ className }: StorageWidgetProps) {
    const { selectedCaseId } = useCase()
    const [data, setData] = useState<StorageData | null>(null)

    useEffect(() => {
        const fetchData = async () => {
            if (!selectedCaseId) {
                setData(null)
                return
            }
            try {
                const res = await fetch(API.path(`/system/storage?case_id=${selectedCaseId}`))
                if (res.ok) {
                    const json = await res.json()
                    setData(json)
                }
            } catch (error) {
                console.error('Failed to fetch storage data:', error)
            }
        }

        fetchData()
    }, [selectedCaseId])

    if (!selectedCaseId) {
        return (
            <Card className={`bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full ${className}`}>
                <CardContent className="flex items-center justify-center h-full text-gray-500">
                    <p className="text-sm">Select a case to view storage usage</p>
                </CardContent>
            </Card>
        )
    }

    if (!data) return (
        <Card className={`bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full ${className}`}>
            <CardContent className="flex-1 p-4 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </CardContent>
        </Card>
    )

    // const usedPercentage = ((data.total - data.free) / data.total) * 100

    // Filter breakdown to only show Backups and Reports
    const displayBreakdown = data.breakdown.filter(item =>
        item.name === 'Backups' || item.name === 'Reports'
    )

    // Calculate total size of displayed items (Backups + Reports)
    const totalDisplayed = displayBreakdown.reduce((acc, item) => acc + item.value, 0)

    return (
        <Card className={`bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full ${className}`}>
            <div className="px-0 h-10 bg-transparent flex justify-between items-center">
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <Database size={14} className="text-gray-400/70" />
                    Storage
                </h3>
                <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
                    System {formatBytes(data.total - data.free)} / {formatBytes(data.total)}
                </span>
            </div>
            <CardContent className="flex-1 p-0 pt-0 flex flex-col">

                <div className="flex-1 min-h-0 flex items-center justify-center gap-4 py-2 overflow-y-auto overflow-x-hidden">
                    <div className="h-full aspect-square relative max-h-[220px]" style={{ outline: 'none', outlineStyle: 'none' }}>
                        <style>{`
                            .recharts-wrapper,
                            .recharts-responsive-container {
                                outline: none !important;
                            }
                            .recharts-wrapper:focus,
                            .recharts-responsive-container:focus {
                                outline: none !important;
                            }
                        `}</style>
                        <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                            <PieChart style={{ outline: 'none' }}>
                                <Pie
                                    data={displayBreakdown}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={60}
                                    outerRadius={80}
                                    paddingAngle={2}
                                    dataKey="value"
                                    stroke="none"
                                    isAnimationActive={false}
                                >
                                    {displayBreakdown.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.name === 'Backups' ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.4)'}
                                        />
                                    ))}
                                </Pie>

                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="text-center">
                                <div className="text-xl font-bold text-white/80">{formatBytes(totalDisplayed)}</div>
                                <div className="text-xs text-gray-500/70">Used</div>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2 flex-1 min-w-0 max-w-[200px]">
                        {displayBreakdown.map((item) => (
                            <div key={item.name} className="flex items-center justify-between text-sm">
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <div
                                        className="w-2.5 h-2.5 rounded-full opacity-70 shrink-0"
                                        style={{ backgroundColor: item.name === 'Backups' ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.4)' }}
                                    />
                                    <span className="text-gray-300/80 truncate text-xs">{item.name}</span>
                                </div>
                                <span className="text-gray-500/70 font-mono text-[10px] shrink-0">{formatBytes(item.value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
