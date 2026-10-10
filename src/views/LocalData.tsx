// Controls for local mode (no sign-in): picking a data file to upload, and the mode's icon.

import { useRef, type ReactNode } from 'react'

export function UploadButton({ onFile, disabled, className, children }: { onFile: (file: File) => void; disabled?: boolean; className?: string; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()} disabled={disabled}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Clear the choice so picking the same file again still uploads it.
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
    </>
  )
}

export function DeviceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  )
}
