import { useState, type InputHTMLAttributes } from 'react'

// Number field that only reports a value once the user leaves it, so typing "1." or "-" is not lost.
export function NumberInput({
  value,
  onCommit,
  digits = 8,
  ...rest
}: { value: number; onCommit: (v: number) => void; digits?: number } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      {...rest}
      inputMode="decimal"
      value={draft ?? value.toLocaleString('en-US', { maximumFractionDigits: digits })}
      onFocus={() => setDraft(String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = Number((draft ?? '').replace(/,/g, ''))
        if (draft !== null && draft.trim() !== '' && Number.isFinite(v)) onCommit(v)
        setDraft(null)
      }}
    />
  )
}
