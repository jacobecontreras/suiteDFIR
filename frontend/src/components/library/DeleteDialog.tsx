import { Button } from '@/components/ui';

export interface DeleteDialogProps {
    isOpen: boolean;
    title: string;
    itemName: string;
    onConfirm: () => void;
    onClose: () => void;
}

export function DeleteDialog({
    isOpen,
    title,
    itemName,
    onConfirm,
    onClose
}: DeleteDialogProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1A1A1A] border border-[#333333] rounded-xl p-5 max-w-[340px]">
                <h3 className="text-sm font-semibold text-white tracking-wide uppercase mb-3">{title}</h3>
                <p className="text-[11px] text-gray-400 mb-4">
                    Are you sure you want to delete <span className="text-white font-medium">{itemName}</span>? This action cannot be undone.
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1 h-8 text-[11px] bg-[#222] hover:bg-[#2a2a2a] text-gray-300 border border-white/5"
                        onClick={onClose}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        size="sm"
                        className="flex-1 h-8 text-[11px] bg-red-900/20 hover:bg-red-900/40 text-white border border-red-900/30"
                        onClick={onConfirm}
                    >
                        Delete
                    </Button>
                </div>
            </div>
        </div>
    );
}
