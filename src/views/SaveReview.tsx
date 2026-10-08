import { useEffect, useRef } from 'react'
import { changeRatio, type Change } from '../history'
import { ChangeRow } from './History'

interface Props {
  changes: Change[]
  busy: boolean
  canRevert: (c: Change) => boolean
  onRevert: (c: Change) => void
  onConfirm: () => void
  onCancel: () => void
}

// Shown before a save that changes balances or holdings: these edits become history,
// so a typo is caught (and undone) here instead of being kept forever.
export function SaveReview({ changes, busy, canRevert, onRevert, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])
  const big = changes.filter((c) => c.before && c.after && changeRatio(c) >= 0.5).length

  return (
    <dialog ref={ref} className="review" onCancel={onCancel} aria-labelledby="review-title">
      <h3 id="review-title">確認要儲存的變更</h3>
      <p className="muted small">
        以下 {changes.length} 項會記錄到歷史，原本的數字會保留。打錯的可以按「復原」改回去。
      </p>
      {big > 0 && (
        <p className="notice">
          <span aria-hidden>⚠</span> 有 {big} 項變動超過 50%，請確認不是多打或少打了位數。
        </p>
      )}
      <div className="changes review-list">
        <ul>
          {changes.map((c, i) => {
            const ratio = changeRatio(c)
            return (
              <ChangeRow
                key={i}
                c={c}
                showAccount
                showTime={false}
                extra={
                  <>
                    {Number.isFinite(ratio) && ratio >= 0.5 && <span className="tag warn">變動 {Math.round(ratio * 100)}%</span>}
                    {canRevert(c) && (
                      <button className="small" onClick={() => onRevert(c)} disabled={busy}>
                        復原
                      </button>
                    )}
                  </>
                }
              />
            )
          })}
        </ul>
      </div>
      <div className="row review-actions">
        <button onClick={onCancel} disabled={busy}>
          繼續編輯
        </button>
        <button className="primary" onClick={onConfirm} disabled={busy}>
          {busy ? '儲存中…' : '確認儲存'}
        </button>
      </div>
    </dialog>
  )
}
