import { useMemo } from 'react';
import { Search, FileText, FolderOpen, Trash2 } from 'lucide-react';
import { LoadingPage, LibraryCard } from '@/components/ui/index';
import { useDragScroll } from '@/hooks/useDragScroll';
import { Report } from '@/types/report';

interface ReportsLibraryProps {
    reports: Report[];
    isLoading: boolean;
    selectedReportId: number | null;
    filter: 'all' | 'ileapp' | 'aleapp';
    sort: 'newest' | 'oldest' | 'name';
    searchQuery: string;
    setFilter: (filter: 'all' | 'ileapp' | 'aleapp') => void;
    setSort: (sort: 'newest' | 'oldest' | 'name') => void;
    setSearchQuery: (query: string) => void;
    onViewReport: (report: Report) => void;
    onOpenClick: (report: Report) => void;
    onDeleteClick: (report: Report) => void;
}

export default function ReportsLibrary({
    reports,
    isLoading,
    selectedReportId,
    filter,
    sort,
    searchQuery,
    setFilter,
    setSort,
    setSearchQuery,
    onViewReport,
    onOpenClick,
    onDeleteClick,
}: ReportsLibraryProps) {
    const dragScroll = useDragScroll([reports, filter, searchQuery, sort]);

    const filteredReports = useMemo(() =>
        reports
            .filter(r => {
                if (filter !== 'all' && r.tool !== filter) return false;
                if (searchQuery && !r.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
                return true;
            })
            .sort((a, b) => {
                if (sort === 'newest') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
                if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
                return a.name.localeCompare(b.name);
            }),
        [reports, filter, sort, searchQuery]
    );

    return (
        <div className="flex-[15] flex flex-col gap-0 min-h-[140px] border border-white/10 rounded-xl bg-[#1A1A1A]/30 overflow-hidden pb-2">
            <div className="flex-1 flex flex-col gap-2 min-h-0 pb-2 pt-2 px-4">
                {/* Header with Controls */}
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">Reports Library</label>
                        <div className="flex gap-1 bg-[#1A1A1A] p-0.5 rounded-lg border border-white/10">
                            <button
                                onClick={() => setFilter('all')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === 'all' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                All ({reports.length})
                            </button>
                            <button
                                onClick={() => setFilter('ileapp')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === 'ileapp' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                iLEAPP ({reports.filter(r => r.tool === 'ileapp').length})
                            </button>
                            <button
                                onClick={() => setFilter('aleapp')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${filter === 'aleapp' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                aLEAPP ({reports.filter(r => r.tool === 'aleapp').length})
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <div className="relative w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                            <input
                                type="text"
                                placeholder="Search reports..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-[#1A1A1A] border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
                            />
                        </div>
                        <select
                            value={sort}
                            onChange={(e) => setSort(e.target.value as 'newest' | 'oldest' | 'name')}
                            className="bg-[#1A1A1A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer text-center"
                        >
                            <option value="newest">Newest First</option>
                            <option value="oldest">Oldest First</option>
                            <option value="name">Name (A-Z)</option>
                        </select>
                    </div>
                </div>

                {/* Horizontal Scrollable Report Cards */}
                <div
                    ref={dragScroll.scrollContainerRef}
                    className={`report-cards-container flex-1 overflow-x-auto overflow-y-hidden min-h-0 [&::-webkit-scrollbar]:hidden ${dragScroll.isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    onMouseDown={dragScroll.onMouseDown}
                    onMouseLeave={dragScroll.onMouseLeave}
                    onMouseUp={dragScroll.onMouseUp}
                    onMouseMove={dragScroll.onMouseMove}
                >
                    {isLoading ? (
                        <LoadingPage />
                    ) : filteredReports.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-500 text-sm">No reports found</div>
                    ) : (
                        <div className="flex gap-3 h-full items-center">
                            {filteredReports.map((report) => (
                                <LibraryCard
                                    key={report.id}
                                    data-report-id={report.id}
                                    className="report-card w-72"
                                    title={report.name}
                                    isSelected={selectedReportId === report.id}
                                    onClick={() => onViewReport(report)}
                                    icon={
                                        /* eslint-disable-next-line @next/next/no-img-element */
                                        <img
                                            src={report.tool === 'ileapp' ? '/apple-logo.svg' : '/android-logo.svg'}
                                            alt={report.tool}
                                            className="max-h-full max-w-full object-contain"
                                            style={{
                                                filter: report.tool === 'ileapp'
                                                    ? 'brightness(0) invert(1)'
                                                    : 'brightness(0) saturate(100%) invert(80%) sepia(16%) saturate(1088%) hue-rotate(32deg) brightness(92%) contrast(87%)'
                                            }}
                                        />
                                    }
                                    subtitle={
                                        <span className="flex items-center gap-1.5 shrink-0">
                                            <span className="flex items-center gap-0.5 shrink-0">
                                                <FileText size={9} className="shrink-0" />
                                                <span>{new Date(report.created_at).toLocaleDateString()}</span>
                                            </span>
                                            <span className="shrink-0">&bull;</span>
                                            <span className="shrink-0">{report.size}</span>
                                        </span>
                                    }
                                    actions={[
                                        {
                                            icon: FolderOpen,
                                            label: 'Open in Finder',
                                            onClick: () => onOpenClick(report)
                                        },
                                        {
                                            icon: Trash2,
                                            label: 'Delete Report',
                                            variant: 'destructive',
                                            onClick: () => onDeleteClick(report)
                                        }
                                    ]}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Custom Minimal Scrollbar */}
            {filteredReports.length > 0 && dragScroll.thumbWidth < 100 && (
                <div
                    ref={dragScroll.scrollbarRef}
                    className="h-1 bg-white/5 rounded-full mx-4 relative cursor-pointer"
                    onMouseDown={dragScroll.onScrollbarTrackClick}
                >
                    <div
                        className={`absolute top-0 h-full bg-white/30 rounded-full transition-colors hover:bg-white/50 ${dragScroll.isScrollbarDragging ? 'bg-white/50' : ''}`}
                        style={{
                            width: `${dragScroll.thumbWidth}%`,
                            left: `${dragScroll.scrollProgress * (100 - dragScroll.thumbWidth)}%`,
                            cursor: dragScroll.isScrollbarDragging ? 'grabbing' : 'grab',
                        }}
                        onMouseDown={(e) => {
                            e.stopPropagation();
                            dragScroll.onScrollbarMouseDown(e);
                        }}
                    />
                </div>
            )}
        </div>
    );
}
