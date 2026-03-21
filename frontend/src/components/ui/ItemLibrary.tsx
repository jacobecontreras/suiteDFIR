import { ReactNode } from 'react';

interface ItemLibraryProps {
    /** Section title shown in the header bar. */
    title?: string;
    /** Optional phantom card rendered at the top (e.g. an in-progress placeholder). */
    phantomCard?: ReactNode;
    /** The rendered LibraryCard elements. */
    children?: ReactNode;
}

/**
 * A shared container for library sections (Report Library, Backup Library, etc.).
 * Provides the title bar and scrollable card area.
 * Consumers are responsible for rendering their own LibraryCard items as children.
 */
export function ItemLibrary({
    title = 'Library',
    phantomCard,
    children
}: ItemLibraryProps) {
    return (
        <div className="flex-1 flex flex-col min-h-0 bg-[#171717] border border-[#333333] rounded-lg overflow-hidden animate-in fade-in duration-500">
            <div className="px-4 py-2 border-b border-[#333333] bg-[#1A1A1A]">
                <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">{title}</h3>
            </div>
            <div className="flex-1 flex flex-col p-0 min-h-0 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                    {phantomCard}
                    {children}
                </div>
            </div>
        </div>
    );
}
