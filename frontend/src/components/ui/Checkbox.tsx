import { forwardRef } from "react"
import { cn } from "@/lib/utils"
import { Check, Minus } from "lucide-react"

export interface CheckboxProps {
  checked?: boolean | "indeterminate"
  onCheckedChange?: (checked: boolean) => void
  className?: string
  disabled?: boolean
  "aria-label"?: string
}

const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, disabled, ...props }, ref) => {
    const isChecked = checked === true
    const isIndeterminate = checked === "indeterminate"

    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={isIndeterminate ? "mixed" : isChecked}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!isChecked)}
        className={cn(
          "h-4 w-4 shrink-0 rounded border border-white/30 ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-colors flex items-center justify-center",
          (isChecked || isIndeterminate) && "bg-primary border-primary",
          className
        )}
        {...props}
      >
        {isChecked && (
          <Check className="h-3 w-3 text-primary-foreground" />
        )}
        {isIndeterminate && (
          <Minus className="h-3 w-3 text-primary-foreground" />
        )}
      </button>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }

// Keep the old default export for backward compatibility
interface LegacyCheckboxProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label?: string;
}

export default function LegacyCheckbox({ checked, onChange, disabled = false, label }: LegacyCheckboxProps) {
  return (
    <label className="flex items-center space-x-3 p-2 rounded hover:bg-[#30444f] cursor-pointer transition-colors">
      <div className="relative">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          className="w-4 h-4 rounded border border-white focus:ring-2 focus:ring-gray-600 appearance-none"
          style={{ borderWidth: '0.5px', backgroundColor: checked ? '#30444f' : 'transparent' }}
        />
        {checked && (
          <svg className="absolute w-3 h-3 text-white pointer-events-none" style={{ top: '3.5px', left: '2px' }} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )}
      </div>
      {label && <span className="text-sm flex-1 text-white">{label}</span>}
    </label>
  );
}