import { useState } from 'react'
import { fmt, pct } from '../format'
import type { ColoredSlice } from '../chartColors'
import type { Slice } from '../model'

// Part-to-whole as one horizontal stacked bar plus a legend that carries the numbers.
export function Allocation({ slices }: { slices: ColoredSlice[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const shown = slices.filter((s) => s.share > 0)
  return (
    <div className="alloc">
      <div className="alloc-bar" role="img" aria-label={shown.map((s) => `${s.label} ${pct(s.share)}`).join('，')}>
        {shown.map((s, i) => (
          <span
            key={s.label}
            style={{ flexGrow: s.share, background: s.color }}
            className={hover === null || hover === i ? '' : 'dim'}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        {hover !== null && shown[hover] && (
          <div className="tip">
            <strong>{shown[hover].label}</strong>
            <span>
              NT$ {fmt(shown[hover].value, 0)} · {pct(shown[hover].share)}
            </span>
          </div>
        )}
      </div>
      <ul className="legend">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={hover === null || shown[hover]?.label === s.label ? '' : 'dim'}
            onMouseEnter={() => setHover(shown.indexOf(s) >= 0 ? shown.indexOf(s) : null)}
            onMouseLeave={() => setHover(null)}
            data-i={i}
          >
            <i style={{ background: s.color }} />
            <span className="label">{s.label}</span>
            <span className="value">{fmt(s.value, 0)}</span>
            <span className="share">{pct(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Magnitude ranking in a single hue; long tails fold into 其他.
export function RankBars({ slices, limit = 8, onSelect }: { slices: Slice[]; limit?: number; onSelect?: (label: string) => void }) {
  const head = slices.slice(0, limit)
  const tail = slices.slice(limit)
  const rows = tail.length
    ? [...head, { label: `其他 ${tail.length} 個`, value: tail.reduce((s, x) => s + x.value, 0), share: tail.reduce((s, x) => s + x.share, 0) }]
    : head
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="rank">
      {rows.map((r, i) => (
        <li key={r.label}>
          <button disabled={!onSelect || i >= head.length} onClick={() => onSelect?.(r.label)}>
            <span className="label">{r.label}</span>
            <span className="value">{fmt(r.value, 0)}</span>
            <span className="share">{pct(r.share)}</span>
            <span className="track">
              <span style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
