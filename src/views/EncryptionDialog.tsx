import { useEffect, useRef, useState } from 'react'

export function EncryptionDialog({ creating, onSubmit, onCancel }: {
  creating: boolean
  onSubmit: (password: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { ref.current?.showModal() }, [])
  return (
    <dialog ref={ref} className="review" aria-labelledby="encryption-title" onCancel={onCancel}>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (creating && password !== confirmation) { setError('兩次密碼不一致'); return }
        onSubmit(password)
      }}>
        <h3 id="encryption-title">{creating ? '啟用資料加密' : '解鎖資產資料'}</h3>
        <p className="muted small">{creating
          ? '儲存後，Drive 檔案需要密碼才能讀取。請使用獨立的長密碼並妥善保存；忘記密碼無法復原。舊版本與既有備份不會自動加密。啟用前請關閉其他分頁與裝置中的舊工作階段。'
          : '請輸入這份資料的加密密碼。密碼只用於本機解密，不會上傳。'}</p>
        <label className="field"><span>加密密碼</span>
          <input type="password" autoFocus required minLength={creating ? 12 : 1} maxLength={1024}
            autoComplete={creating ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {creating && <label className="field"><span>再次輸入密碼</span>
          <input type="password" required autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
        </label>}
        {error && <p className="banner error" role="alert">{error}</p>}
        <div className="row review-actions">
          <button type="button" onClick={onCancel}>取消</button>
          <button className="primary" type="submit">{creating ? '加密並儲存' : '解鎖'}</button>
        </div>
      </form>
    </dialog>
  )
}
