import type { InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  onStep?: (value: string) => void;
  increment?: number;
  type?: "number" | "text";
};

export default function NumericInput({ value, onValueChange, onStep, increment, step, min, max,
  type = "number", className = "", disabled, "aria-label": ariaLabel, ...props }: Props) {
  const amount = increment ?? (step === "any" ? 1 : Number(step) || 1);
  const minimum = min === undefined ? -Infinity : Number(min);
  const maximum = max === undefined ? Infinity : Number(max);
  const numericValue = value === "" ? null : Number(value);

  function change(direction: -1 | 1) {
    const start = numericValue !== null && Number.isFinite(numericValue)
      ? numericValue : direction > 0 ? Number.isFinite(minimum) ? minimum - amount : 0
        : Number.isFinite(maximum) ? maximum + amount : 0;
    const decimals = Math.max((String(amount).split(".")[1] ?? "").length,
      (String(numericValue ?? "").split(".")[1] ?? "").length,
      (String(min ?? "").split(".")[1] ?? "").length);
    const next = Math.max(minimum, Math.min(maximum, Number((start + direction * amount).toFixed(Math.min(decimals, 10)))));
    onValueChange(String(next));
    onStep?.(String(next));
  }

  return <div className="relative mt-1 min-w-0">
    <input {...props} type={type} value={value} min={min} max={max} step={step} disabled={disabled}
      aria-label={ariaLabel} onChange={event => onValueChange(event.target.value)}
      className={`orbis-numeric-input ${className.replace(/\bmt-1\b/g, "")} pr-8`} />
    <div className="absolute right-1 top-1/2 flex -translate-y-1/2 flex-col">
      <button type="button" disabled={disabled || numericValue !== null && numericValue >= maximum}
        aria-label={`Increase ${ariaLabel ?? "value"}`} onMouseDown={event => event.preventDefault()}
        onClick={event => { event.preventDefault(); event.stopPropagation(); change(1); }}
        className="flex h-[17px] w-5 items-center justify-center text-[#aeb5b9] hover:bg-[#424b50] hover:text-white disabled:opacity-40">
        <span className="h-0 w-0 border-x-[4px] border-b-[6px] border-x-transparent border-b-current" />
      </button>
      <button type="button" disabled={disabled || numericValue !== null && numericValue <= minimum}
        aria-label={`Decrease ${ariaLabel ?? "value"}`} onMouseDown={event => event.preventDefault()}
        onClick={event => { event.preventDefault(); event.stopPropagation(); change(-1); }}
        className="flex h-[17px] w-5 items-center justify-center text-[#aeb5b9] hover:bg-[#424b50] hover:text-white disabled:opacity-40">
        <span className="h-0 w-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-current" />
      </button>
    </div>
  </div>;
}
