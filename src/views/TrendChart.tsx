import { useEffect, useRef, useState } from 'react'
import { fmt } from '../format'

export interface Series {
  key: string
  label: string
  color: string
  values: number[] // one per date
}

const HEIGHT = 260
const PAD = { top: 12, right: 16, bottom: 28, left: 60 }
const compact = new Intl.NumberFormat('zh-TW', { notation: 'compact', maximumFractionDigits: 1 })

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1
    min -= pad
    max += pad
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const ticks: number[] = []
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

const shortDate = (d: string, withYear: boolean) => {
  const [y, m, day] = d.split('-')
  return withYear ? `${y}/${Number(m)}/${Number(day)}` : `${Number(m)}/${Number(day)}`
}

// Values over time on one shared axis, with a crosshair that lists every series on hover.
export function TrendChart({ dates, series, area = false }: { dates: string[]; series: Series[]; area?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const times = dates.map((d) => Date.parse(`${d}T00:00:00`))
  const t0 = times[0]
  const t1 = times[times.length - 1]
  const all = series.flatMap((s) => s.values)
  const ticks = niceTicks(Math.min(...all), Math.max(...all))
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  const innerW = Math.max(width - PAD.left - PAD.right, 1)
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (t1 === t0 ? innerW / 2 : ((times[i] - t0) / (t1 - t0)) * innerW)
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH

  const multiYear = dates[0]?.slice(0, 4) !== dates[dates.length - 1]?.slice(0, 4)
  // Date labels at evenly spaced points, always keeping the first and last and
  // skipping any that would crowd a neighbor.
  const xLabels: number[] = []
  const want = Math.min(Math.max(2, Math.floor(innerW / 90)), dates.length)
  for (let k = 0; k < want; k++) {
    const i = want === 1 ? 0 : Math.round((k * (dates.length - 1)) / (want - 1))
    const last = i === dates.length - 1
    if (xLabels.includes(i)) continue
    while (last && xLabels.length > 1 && x(i) - x(xLabels[xLabels.length - 1]) <= 70) xLabels.pop()
    if (xLabels.length === 0 || x(i) - x(xLabels[xLabels.length - 1]) > 70) xLabels.push(i)
  }

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left + PAD.left
    let best = 0
    for (let i = 1; i < dates.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
    setHover(best)
  }

  const showDots = dates.length <= 40
  const tipLeft = hover !== null && x(hover) > width / 2

  return (
    <div className="trend" ref={ref}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label="資產走勢圖">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {compact.format(t)}
              </text>
            </g>
          ))}
          {xLabels.map((i) => (
            <text
              key={i}
              className="axis"
              x={x(i)}
              y={HEIGHT - 8}
              textAnchor={dates.length === 1 ? 'middle' : i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
            >
              {shortDate(dates[i], multiYear)}
            </text>
          ))}
          {area && series.length === 1 && dates.length > 1 && (
            <path
              className="area"
              style={{ fill: series[0].color }}
              d={`M${x(0)},${y(lo)} ${series[0].values.map((v, i) => `L${x(i)},${y(v)}`).join(' ')} L${x(dates.length - 1)},${y(lo)} Z`}
            />
          )}
          {series.map((s) => (
            <g key={s.key} style={{ color: s.color }}>
              {dates.length > 1 && <path className="line" d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')} />}
              {(showDots || dates.length === 1) && s.values.map((v, i) => <circle key={i} className="dot" cx={x(i)} cy={y(v)} r={3.5} />)}
            </g>
          ))}
          {hover !== null && (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />
              {series.map((s) => (
                <circle key={s.key} className="dot hot" style={{ color: s.color }} cx={x(hover)} cy={y(s.values[hover])} r={5} />
              ))}
            </g>
          )}
          <rect
            x={PAD.left - 10}
            y={0}
            width={innerW + 20}
            height={HEIGHT}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && (
        <div
          className="tip trend-tip"
          style={tipLeft ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}
        >
          <strong>{shortDate(dates[hover], true)}</strong>
          {[...series]
            .sort((a, b) => b.values[hover] - a.values[hover])
            .map((s) => (
              <span key={s.key} className="tip-row">
                {series.length > 1 && <i style={{ background: s.color }} />}
                {series.length > 1 && <span className="label">{s.label}</span>}
                <span className="value">NT$ {fmt(s.values[hover], 0)}</span>
              </span>
            ))}
        </div>
      )}
      {series.length > 1 && (
        <ul className="legend inline">
          {series.map((s) => (
            <li key={s.key}>
              <i style={{ background: s.color }} />
              <span className="label">{s.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
