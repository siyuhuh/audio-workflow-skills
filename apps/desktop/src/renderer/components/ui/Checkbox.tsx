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
        "captureCheck",
        checked && "captureCheck--on",
        disabled && "captureCheck--disabled",
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="captureCheckInput"
      />
      <span className="captureCheckBox" aria-hidden="true" />
      <span className="captureCheckLabel">{label}</span>
    </label>
  );
}
