import { Outlet } from 'react-router-dom'
import { useEffect, useState, Suspense } from 'react'
import { SidebarProvider, SidebarInset } from '@/components/ui/Sidebar'
import { AppSidebar } from '@/components/AppSidebar'
import { ReportsProvider } from '@/context/ReportsContext'
import { DashboardProvider } from '@/context/DashboardContext'
import { SpatialProvider } from '@/context/SpatialContext'
import { LeappProvider } from '@/context/LeappContext'
import { BackupProvider } from '@/context/BackupContext'
import { LoadingPage } from '@/components/ui/LoadingPage'

export default function MainLayout() {
    const [defaultOpen, setDefaultOpen] = useState(true)

    useEffect(() => {
        const storedState = localStorage.getItem('sidebar_state')
        if (storedState !== null) {
            setDefaultOpen(storedState === 'true')
        }
    }, [])

    return (
        <ReportsProvider>
            <DashboardProvider>
                <SpatialProvider>
                    <LeappProvider>
                        <BackupProvider type="ios">
                        <BackupProvider type="android">
                                <SidebarProvider defaultOpen={defaultOpen} className="h-full w-full min-h-0 overflow-hidden">
                                    <AppSidebar />
                                    <SidebarInset className="bg-[#151515] flex flex-col overflow-hidden h-full min-h-0">
                                        <Suspense fallback={<LoadingPage />}>
                                            <Outlet />
                                        </Suspense>
                                    </SidebarInset>
                                </SidebarProvider>
                        </BackupProvider>
                        </BackupProvider>
                    </LeappProvider>
                </SpatialProvider>
            </DashboardProvider>
        </ReportsProvider>
    )
}
