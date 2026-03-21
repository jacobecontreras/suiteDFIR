import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import BackupPage from './BackupPage'

const EXTRACTION_TYPES = ['ios', 'android'] as const
type ExtractionType = typeof EXTRACTION_TYPES[number]

function isExtractionType(value: string | null): value is ExtractionType {
    return value === 'ios' || value === 'android'
}

export default function ExtractionPage() {
    const [searchParams, setSearchParams] = useSearchParams()
    const requestedType = searchParams.get('type')
    const activeType: ExtractionType = isExtractionType(requestedType) ? requestedType : 'ios'

    useEffect(() => {
        if (!isExtractionType(requestedType)) {
            setSearchParams({ type: 'ios' }, { replace: true })
        }
    }, [requestedType, setSearchParams])

    return (
        <div className="h-full flex flex-col bg-[#151515] text-white">
            <div className="flex-1 min-h-0 relative">
                <div className={cn('absolute inset-0', activeType !== 'ios' && 'hidden')}>
                    <BackupPage
                        type="ios"
                        actionSlot={
                            <div className="h-9 w-full rounded-md border border-[#333333] bg-[#171717] p-1 flex gap-1">
                                {EXTRACTION_TYPES.map((type) => {
                                    const isActive = type === activeType
                                    const label = type === 'ios' ? 'iOS' : 'Android'

                                    return (
                                        <Button
                                            key={type}
                                            variant="ghost"
                                            onClick={() => setSearchParams({ type })}
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
                        }
                    />
                </div>
                <div className={cn('absolute inset-0', activeType !== 'android' && 'hidden')}>
                    <BackupPage
                        type="android"
                        actionSlot={
                            <div className="h-9 w-full rounded-md border border-[#333333] bg-[#171717] p-1 flex gap-1">
                                {EXTRACTION_TYPES.map((type) => {
                                    const isActive = type === activeType
                                    const label = type === 'ios' ? 'iOS' : 'Android'

                                    return (
                                        <Button
                                            key={type}
                                            variant="ghost"
                                            onClick={() => setSearchParams({ type })}
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
                        }
                    />
                </div>
            </div>
        </div>
    )
}
