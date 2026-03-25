
import { cn } from '@/lib/utils'

interface LoadingPageProps {
    className?: string
}

export function LoadingPage({ className }: LoadingPageProps) {
    return (
        <div className={cn("flex-1 w-full flex items-center justify-center bg-[#151515] text-white min-h-[50vh]", className)}>
            <div className="flex flex-col items-center gap-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                <div className="text-sm text-gray-500">Loading...</div>
            </div>
        </div>
    );
}
