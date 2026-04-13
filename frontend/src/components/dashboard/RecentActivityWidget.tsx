import { useState, useEffect } from 'react'
import { Card, CardContent } from "@/components/ui/Card"
import { Clock, FileText, Smartphone, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { useCase } from "@/context/CaseContext"
import { useNavigate } from 'react-router-dom'
import { cn } from "@/lib/utils"
import { API } from "@/lib/api"

interface Activity {
    id: number
    name: string
    type: 'backup' | 'report'
    status: string
    created_at: string
    path?: string  // Report path for deep linking
}

export default function RecentActivityWidget() {
    const { selectedCaseId } = useCase()
    const navigate = useNavigate()
    const [activities, setActivities] = useState<Activity[]>([])

    useEffect(() => {
        const fetchData = async () => {
            if (!selectedCaseId) {
                setActivities([])
                return
            }
            try {
                const res = await fetch(API.path(`/dashboard/activity?case_id=${selectedCaseId}`))
                if (res.ok) {
                    const json = await res.json()
                    setActivities(json.activities || [])
                }
            } catch (error) {
                console.error('Failed to fetch activity:', error)
            }
        }

        fetchData()

        // Subscribe to SSE stream
        const eventSource = new EventSource(API.path('/stream'))

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                // Refresh on backup updates
                if (data.type === 'backup_update') {
                    fetchData()
                }
            } catch (error) {
                console.error('Error parsing SSE message:', error)
            }
        }

        return () => {
            eventSource.close()
        }
    }, [selectedCaseId])

    const getIcon = (type: string) => {
        return type === 'backup'
            ? <Smartphone size={14} className="text-gray-400/70" />
            : <FileText size={14} className="text-gray-400/70" />
    }

    const getStatusIcon = (status: string) => {
        switch (status.toLowerCase()) {
            case 'completed': return <CheckCircle size={12} className="text-white/70" />
            case 'failed': return <XCircle size={12} className="text-white/40" />
            case 'running': return <AlertCircle size={12} className="text-white/60 animate-pulse" />
            default: return <div className="w-2 h-2 rounded-full bg-gray-500/50" />
        }
    }

    const formatTime = (dateStr: string) => {
        // Ensure date is treated as UTC if it comes as "YYYY-MM-DD HH:MM:SS"
        const utcDateStr = dateStr.endsWith('Z') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
        const date = new Date(utcDateStr)
        const now = new Date()
        const diff = (now.getTime() - date.getTime()) / 1000 // seconds

        if (diff < 60) return 'Just now'
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
        return date.toLocaleDateString()
    }

    if (!selectedCaseId) {
        return (
            <Card className="bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full">
                <CardContent className="flex items-center justify-center h-full text-gray-500">
                    <p className="text-sm">Select a case to view activity</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="bg-transparent border-none shadow-none flex flex-col overflow-hidden h-full">
            <div className="px-0 h-10 bg-transparent flex justify-between items-center">
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <Clock size={14} className="text-gray-400/70" />
                    Recent Activity
                </h3>
            </div>
            <CardContent className="flex-1 p-0 pt-0 flex flex-col min-h-0">

                <div className="flex-1 overflow-y-auto pr-1 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                    <div className={cn(
                        "relative min-h-full flex flex-col pb-2",
                        activities.length === 0 ? "justify-center" : "justify-start"
                    )}>
                        {activities.length === 0 ? (
                            <div className="flex items-center justify-center text-xs text-gray-500 py-4 font-medium">
                                No recent activity
                            </div>
                        ) : (
                            <div className="space-y-1 p-2">
                                {activities.map((activity, i) => (
                                    <div
                                        key={`${activity.type}-${activity.id}`}
                                        onClick={() => activity.type === 'report' && activity.path && navigate(`/library/reports?path=${encodeURIComponent(activity.path)}`)}
                                        className={`flex gap-3 relative z-10 p-2 rounded-lg transition-all duration-200 ${activity.type === 'report' ? 'cursor-pointer hover:bg-white/[0.03] group/item' : ''}`}
                                    >
                                        <div className="w-10 flex flex-col items-center shrink-0 relative">
                                            <div className="w-8 h-8 rounded-full bg-[#212121] border border-[#333333] flex items-center justify-center shadow-sm z-10 relative group-hover/item:border-white/20 transition-colors">
                                                {getIcon(activity.type)}
                                            </div>
                                            {i !== activities.length - 1 && (
                                                <div className="absolute top-8 bottom-[-24px] w-[1px] bg-[#333333] left-1/2 -translate-x-1/2" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 py-1">
                                            <div className="flex items-center justify-between">
                                                <p className="text-xs font-medium text-gray-200 truncate pr-2 group-hover/item:text-white transition-colors">
                                                    {activity.type === 'backup' ? 'Backup: ' : 'Report: '}
                                                    {activity.name}
                                                </p>
                                                <span className="text-[10px] text-gray-500 shrink-0">
                                                    {formatTime(activity.created_at)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                {getStatusIcon(activity.status)}
                                                <span className="text-[10px] text-gray-400 capitalize">
                                                    {activity.status}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
