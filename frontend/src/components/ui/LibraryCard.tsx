import { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { Loader2 } from 'lucide-react';

export interface LibraryCardAction {
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    onClick: (e: React.MouseEvent) => void;
    variant?: 'default' | 'destructive';
    disabled?: boolean;
}

interface LibraryCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'onClick'> {
    title: string;
    subtitle?: ReactNode;
    icon?: ReactNode;
    isSelected?: boolean;
    onClick?: () => void;
    status?: {
        state: 'default' | 'processing' | 'error' | 'success';
        label?: string;
        progress?: number;
    };
    actions?: LibraryCardAction[];
    children?: ReactNode; // For custom content support
}

export function LibraryCard({
    title,
    subtitle,
    icon,
    isSelected,
    onClick,
    status,
    actions = [],
    className,
    children,
    ...props
}: LibraryCardProps) {
    return (
        <div
            className={cn(
                "group flex-shrink-0 w-72 min-h-[60px] rounded-lg p-2.5 flex items-center gap-2 border transition-colors cursor-pointer relative overflow-hidden",
                isSelected
                    ? "bg-[#1A1A1A] border-white/40"
                    : "bg-[#1A1A1A] border-white/10 hover:border-white/20",
                className
            )}
            onClick={onClick}
            {...props}
        >
            {/* Progress Bar Background */}
            {status?.progress !== undefined && status.progress > 0 && (
                <div
                    className="absolute inset-0 bg-white/5 transition-all duration-500 pointer-events-none"
                    style={{ width: `${status.progress}%` }}
                />
            )}

            {/* Icon Container */}
            {icon && (
                <div className="shrink-0 bg-[#1a1a1a] rounded flex items-center justify-center p-0.5 h-8 w-8 relative z-10">
                    {icon}
                </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-center overflow-hidden relative z-10">
                <h3 className="text-white font-medium truncate text-xs w-full text-left mb-0.5">
                    {title}
                </h3>

                {status && status.state !== 'default' ? (
                    <div className={cn(
                        "flex items-center justify-start gap-1.5 text-[10px] uppercase font-bold tracking-wider",
                        status.state === 'processing' && "text-white animate-pulse",
                        status.state === 'error' && "text-red-500",
                        status.state === 'success' && "text-green-500"
                    )}>
                        {status.state === 'processing' && <Loader2 size={8} className="animate-spin" />}
                        {status.label}
                    </div>
                ) : (
                    <div className="flex items-center justify-start gap-1.5 text-[10px] text-gray-400 whitespace-nowrap">
                        {subtitle}
                    </div>
                )}

                {children}
            </div>

            {/* Actions */}
            {actions.length > 0 && (
                <div className="flex items-center gap-0.5 shrink-0 relative z-10">
                    {actions.map((action, index) => (
                        <Button
                            key={index}
                            variant="ghost"
                            size="icon"
                            disabled={action.disabled}
                            onClick={(e) => {
                                e.stopPropagation();
                                action.onClick(e);
                            }}
                            title={action.label}
                            className={cn(
                                "h-6 w-6 shrink-0 text-white",
                                action.variant === 'destructive'
                                    ? "hover:bg-red-900/30 hover:text-red-400"
                                    : "hover:bg-white/20"
                            )}
                        >
                            <action.icon size={11} className="shrink-0" />
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
}
