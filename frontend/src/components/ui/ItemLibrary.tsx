import { Children, ReactNode } from 'react';

interface ItemLibraryProps {
    /** Section title shown in the header bar. */
    title?: string;
    /** Optional phantom card rendered at the top (e.g. an in-progress placeholder). */
    phantomCard?: ReactNode;
    /** The rendered LibraryCard elements. */
    children?: ReactNode;
    /** Minimal text shown when the library has no items. */
    emptyMessage?: string;
}

/**
 * A shared container for library sections (Report Library, Backup Library, etc.).
 * Provides the title bar and scrollable card area.
 * Consumers are responsible for rendering their own LibraryCard items as children.
 */
export function ItemLibrary({
    title = 'Library',
    phantomCard,
    children,
    emptyMessage = 'No items yet.'
}: ItemLibraryProps) {
    const hasContent = Boolean(phantomCard) || Children.count(children) > 0;

    return (
        <div className="flex-1 flex flex-col min-h-0 bg-[#171717] border border-[#333333] rounded-lg overflow-hidden animate-in fade-in duration-500">
            <div className="px-4 py-2 border-b border-[#333333] bg-[#1A1A1A]">
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</h3>
            </div>
            <div className="flex-1 flex flex-col p-0 min-h-0 overflow-hidden">
                {hasContent ? (
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        {phantomCard}
                        {children}
                    </div>
                ) : (
                    <div className="flex-1 flex items-center justify-center px-4">
                        <p className="text-[11px] text-gray-500 uppercase tracking-wider text-center">{emptyMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
