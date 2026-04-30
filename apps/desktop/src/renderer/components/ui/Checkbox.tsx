import { cn } from "../../lib/cn";

interface CheckboxProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export function Checkbox({ label, checked, disabled = false, onChange, className }: CheckboxProps) {
  return (
    <label
      className={cn(
        "flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold text-foreground transition-colors",
        "hover:border-line-strong",
        disabled && "cursor-not-allowed opacity-45",
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 cursor-pointer accent-primary"
      />
      <span className="whitespace-nowrap">{label}</span>
    </label>
  );
}
