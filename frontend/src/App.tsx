import { Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { CaseProvider } from '@/context/CaseContext'
import { APIProvider } from '@/context/APIContext'
import { LoadingPage } from '@/components/ui/LoadingPage'
import MainLayout from './layouts/MainLayout'

// Lazy load pages
const CasesPage = lazy(() => import('./pages/CasesPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'))
const ExtractionPage = lazy(() => import('./pages/ExtractionPage'))
const SpatialPage = lazy(() => import('./pages/SpatialPage'))
const TimelinePage = lazy(() => import('./pages/TimelinePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function App() {
    return (
        <APIProvider>
            <CaseProvider>
                <Suspense fallback={<LoadingPage />}>
                    <Routes>
                        {/* Root redirect */}
                        <Route path="/" element={<Navigate to="/cases" replace />} />

                        {/* Cases page (no sidebar) */}
                        <Route path="/cases" element={<CasesPage />} />

                        {/* Settings page (no sidebar) */}
                        <Route path="/settings" element={<SettingsPage />} />

                        {/* Main layout routes (with sidebar) */}
                        <Route element={<MainLayout />}>
                            <Route path="/dashboard" element={<DashboardPage />} />
                            <Route path="/reports" element={<ReportsPage />} />
                            <Route path="/analysis" element={<AnalysisPage />} />
                            <Route path="/extraction" element={<ExtractionPage />} />
                            <Route path="/ileapp" element={<Navigate to="/analysis?tool=ileapp" replace />} />
                            <Route path="/aleapp" element={<Navigate to="/analysis?tool=aleapp" replace />} />
                            <Route path="/ios-backup" element={<Navigate to="/extraction?type=ios" replace />} />
                            <Route path="/android-backup" element={<Navigate to="/extraction?type=android" replace />} />
                            <Route path="/spatial" element={<SpatialPage />} />
                            <Route path="/timeline" element={<TimelinePage />} />
                        </Route>
                    </Routes>
                </Suspense>
            </CaseProvider>
        </APIProvider>
    )
}

export default App
