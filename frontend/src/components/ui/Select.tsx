import * as React from "react"
import { cn } from "../../lib/utils"
import { ChevronDown, Search, X } from "lucide-react"

// Enhanced Select implementation with search, scrolling, and better UX

interface SelectContextType {
    value: string
    onValueChange: (value: string) => void
    open: boolean
    setOpen: (open: boolean) => void
    searchQuery: string
    setSearchQuery: (query: string) => void
}

const SelectContext = React.createContext<SelectContextType | undefined>(undefined)

const Select = ({
    children,
    value,
    onValueChange,
    open: controlledOpen,
    onOpenChange,
}: {
    children: React.ReactNode,
    value: string,
    onValueChange: (value: string) => void,
    open?: boolean,
    onOpenChange?: (open: boolean) => void,
}) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState("")
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? controlledOpen : uncontrolledOpen

    const setOpen = React.useCallback((val: boolean) => {
        if (isControlled) {
            onOpenChange?.(val)
        } else {
            setUncontrolledOpen(val)
        }
        // Clear search when closing
        if (!val) {
            setSearchQuery("")
        }
    }, [isControlled, onOpenChange])

    const containerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        if (open) {
            document.addEventListener("mousedown", handleClickOutside)
            return () => document.removeEventListener("mousedown", handleClickOutside)
        }
    }, [open, setOpen])

    return (
        <SelectContext.Provider value={{ value, onValueChange, open, setOpen, searchQuery, setSearchQuery }}>
            <div ref={containerRef} className="relative">{children}</div>
        </SelectContext.Provider>
    )
}

const SelectTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectTrigger must be used within Select")

    return (
        <button
            ref={ref}
            type="button"
            onClick={() => context.setOpen(!context.open)}
            className={cn(
                "flex h-10 w-full items-center justify-between rounded-md border border-input bg-[#2b2b2b] px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50",
                className
            )}
            {...props}
        >
            {children}
            {!className?.includes("hide-chevron") && <ChevronDown className="h-4 w-4 opacity-50 ml-2" />}
        </button>
    )
})
SelectTrigger.displayName = "SelectTrigger"

const SelectValue = React.forwardRef<
    HTMLSpanElement,
    React.HTMLAttributes<HTMLSpanElement> & { placeholder?: string }
>(({ className, placeholder, children, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectValue must be used within Select")

    // We need to find the selected item's label. This is tricky without the children being rendered.
    // For now, we'll just display the value if no label logic is implemented, or rely on the user passing the label as children to SelectValue (which isn't how shadcn works).
    // A better approach for this simplified version is to just render the value.

    return (
        <span
            ref={ref}
            className={cn("block truncate", className)}
            {...props}
        >
            {children || context.value || placeholder}
        </span>
    )
})
SelectValue.displayName = "SelectValue"

const SelectContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
        position?: "popper" | "item-aligned",
        side?: "top" | "bottom",
        align?: "start" | "end",
        maxHeight?: string,
        searchable?: boolean,
        itemCount?: number
    }
>(({ className, children, position = "popper", side = "bottom", align = "start", maxHeight = "300px", searchable = false, itemCount = 0, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectContent must be used within Select")

    if (!context.open) return null

    const showSearch = searchable && itemCount > 7

    return (
        <div
            ref={ref}
            className={cn(
                "absolute z-50 min-w-[8rem] max-w-[400px] overflow-hidden rounded-md border border-white/10 bg-[#2b2b2b] text-popover-foreground shadow-lg animate-in fade-in-80",
                side === "bottom" && "top-full mt-1",
                side === "top" && "bottom-full mb-1",
                align === "start" && "left-0 right-0",
                align === "end" && "right-0 left-0",
                className
            )}
            {...props}
        >
            <div className="flex flex-col max-h-[60vh]">
                {showSearch && (
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 sticky top-0 bg-[#2b2b2b] z-10">
                        <Search className="h-4 w-4 text-[#888] flex-shrink-0" />
                        <input
                            type="text"
                            placeholder="Search databases..."
                            value={context.searchQuery}
                            onChange={(e) => context.setSearchQuery(e.target.value)}
                            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-[#666]"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                        />
                        {context.searchQuery && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    context.setSearchQuery("")
                                }}
                                className="flex-shrink-0 text-[#888] hover:text-white"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                )}
                <div className="overflow-y-auto p-1" style={{ maxHeight: showSearch ? `calc(${maxHeight} - 48px)` : maxHeight }}>
                    {children}
                </div>
            </div>
        </div>
    )
})
SelectContent.displayName = "SelectContent"

const SelectItem = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { value: string; disabled?: boolean; hideIndicator?: boolean; filterText?: string }
>(({ className, children, value, disabled, hideIndicator, filterText, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectItem must be used within Select")

    // Filter items based on search query
    const textToMatch = filterText || String(children)
    const matches = !context.searchQuery ||
        textToMatch.toLowerCase().includes(context.searchQuery.toLowerCase())

    if (!matches) return null

    return (
        <div
            ref={ref}
            className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-white/10",
                disabled && "pointer-events-none opacity-50",
                className
            )}
            onClick={() => {
                if (!disabled) {
                    context.onValueChange(value)
                    context.setOpen(false)
                }
            }}
            title={String(children)}
            {...props}
        >
            <span className="truncate block w-full">{children}</span>
            {!hideIndicator && (
                <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
                    {context.value === value && (
                        <span className="h-2 w-2 rounded-full bg-white" />
                    )}
                </span>
            )}
        </div>
    )
})
SelectItem.displayName = "SelectItem"

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
