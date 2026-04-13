import { Search } from 'lucide-react';

export type ReportFilter = 'all' | 'ileapp' | 'aleapp';
export type BackupFilter = 'all' | 'ios' | 'android';
export type SortOption = 'newest' | 'oldest' | 'name';

export interface LibraryFilterCounts {
    reportsCount: number;
    backupsCount: number;
    ileappCount: number;
    aleappCount: number;
    iosBackupsCount: number;
    androidBackupsCount: number;
}

export interface LibraryFiltersProps {
    viewMode: 'reports' | 'backups';
    reportFilter: ReportFilter;
    onReportFilterChange: (filter: ReportFilter) => void;
    backupFilter: BackupFilter;
    onBackupFilterChange: (filter: BackupFilter) => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    sort: SortOption;
    onSortChange: (sort: SortOption) => void;
    counts: LibraryFilterCounts;
}

export function LibraryFilters({
    viewMode,
    reportFilter,
    onReportFilterChange,
    backupFilter,
    onBackupFilterChange,
    searchQuery,
    onSearchChange,
    sort,
    onSortChange,
    counts
}: LibraryFiltersProps) {
    const {
        reportsCount,
        backupsCount,
        ileappCount,
        aleappCount,
        iosBackupsCount,
        androidBackupsCount
    } = counts;

    return (
        <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Filter buttons */}
            <div className="flex items-center gap-4">
                <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider ml-1">
                    {viewMode === 'reports' ? 'Reports Library' : 'Backups Library'}
                </label>
                <div className="flex gap-1 bg-[#1A1A1A] p-0.5 rounded-lg border border-white/10">
                    {viewMode === 'reports' ? (
                        <>
                            <button
                                onClick={() => onReportFilterChange('all')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${reportFilter === 'all' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                All ({reportsCount})
                            </button>
                            <button
                                onClick={() => onReportFilterChange('ileapp')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${reportFilter === 'ileapp' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                iLEAPP ({ileappCount})
                            </button>
                            <button
                                onClick={() => onReportFilterChange('aleapp')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${reportFilter === 'aleapp' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                aLEAPP ({aleappCount})
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => onBackupFilterChange('all')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${backupFilter === 'all' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                All ({backupsCount})
                            </button>
                            <button
                                onClick={() => onBackupFilterChange('ios')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${backupFilter === 'ios' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                iOS ({iosBackupsCount})
                            </button>
                            <button
                                onClick={() => onBackupFilterChange('android')}
                                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${backupFilter === 'android' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                Android ({androidBackupsCount})
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Search and Sort */}
            <div className="flex gap-2">
                <div className="relative w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
                    <input
                        type="text"
                        placeholder={viewMode === 'reports' ? "Search reports..." : "Search backups..."}
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="w-full bg-[#1A1A1A] border border-white/10 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-white/20"
                    />
                </div>
                <select
                    value={sort}
                    onChange={(e) => onSortChange(e.target.value as SortOption)}
                    className="bg-[#1A1A1A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-white/20 appearance-none cursor-pointer text-center"
                >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="name">Name (A-Z)</option>
                </select>
            </div>
        </div>
    );
}
