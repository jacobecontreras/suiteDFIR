import * as React from "react"
import { cn } from "../../lib/utils"
import { ChevronDown } from "lucide-react"

// Simplified Select implementation that wraps a native select but exposes a similar API
// Note: This is a compromise to avoid installing heavy dependencies like @radix-ui/react-select

interface SelectContextType {
    value: string
    onValueChange: (value: string) => void
    open: boolean
    setOpen: (open: boolean) => void
    disabled?: boolean
}

const SelectContext = React.createContext<SelectContextType | undefined>(undefined)

const Select = ({ children, value, onValueChange, disabled }: { children: React.ReactNode, value: string, onValueChange: (value: string) => void, disabled?: boolean }) => {
    const [open, setOpen] = React.useState(false)
    return (
        <SelectContext.Provider value={{ value, onValueChange, open, setOpen, disabled }}>
            <div className="relative">{children}</div>
        </SelectContext.Provider>
    )
}

const SelectTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, disabled, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectTrigger must be used within Select")

    const isDisabled = disabled || context.disabled

    return (
        <button
            ref={ref}
            type="button"
            onClick={() => !isDisabled && context.setOpen(!context.open)}
            disabled={isDisabled}
            className={cn(
                "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
                className
            )}
            {...props}
        >
            {children}
            <ChevronDown className="h-4 w-4 opacity-50" />
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
    React.HTMLAttributes<HTMLDivElement> & { position?: "popper" | "item-aligned" }
>(({ className, children, position = "popper", ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectContent must be used within Select")

    if (!context.open) return null

    return (
        <div
            ref={ref}
            className={cn(
                "absolute right-0 z-50 min-w-[8rem] max-h-80 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-80",
                position === "popper" && "translate-y-1",
                className
            )}
            {...props}
        >
            <div className="p-1">
                {children}
            </div>
        </div>
    )
})
SelectContent.displayName = "SelectContent"

const SelectItem = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { value: string; disabled?: boolean }
>(({ className, children, value, disabled, ...props }, ref) => {
    const context = React.useContext(SelectContext)
    if (!context) throw new Error("SelectItem must be used within Select")

    const isDisabled = disabled || context.disabled

    return (
        <div
            ref={ref}
            className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-accent hover:text-accent-foreground",
                isDisabled && "pointer-events-none opacity-50",
                className
            )}
            onClick={() => {
                if (!isDisabled) {
                    context.onValueChange(value)
                    context.setOpen(false)
                }
            }}
            {...props}
        >
            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                {context.value === value && (
                    <span className="h-2 w-2 rounded-full bg-current" />
                )}
            </span>
            {children}
        </div>
    )
})
SelectItem.displayName = "SelectItem"

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }
