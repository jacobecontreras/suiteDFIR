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
const DBViewerPage = lazy(() => import('./pages/DBViewerPage'))
const LibraryPage = lazy(() => import('./pages/LibraryPage'))
const BackupsListPage = lazy(() => import('./pages/BackupsListPage'))
const PhotosPage = lazy(() => import('./pages/PhotosPage'))

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

                        {/* Main layout routes (with sidebar) */}
                        <Route element={<MainLayout />}>
                            <Route path="/dashboard" element={<DashboardPage />} />

                            {/* Library routes */}
                            <Route path="/library" element={<LibraryPage />} />
                            <Route path="/library/reports" element={<ReportsPage />} />
                            <Route path="/library/backups" element={<BackupsListPage />} />

                            <Route path="/analysis" element={<AnalysisPage />} />
                            <Route path="/extraction" element={<ExtractionPage />} />
                            <Route path="/spatial" element={<SpatialPage />} />
                            <Route path="/db-viewer" element={<DBViewerPage />} />
                            <Route path="/photos" element={<PhotosPage />} />
                        </Route>
                    </Routes>
                </Suspense>
            </CaseProvider>
        </APIProvider>
    )
}

export default App
