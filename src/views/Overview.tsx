import { ACCOUNT_KINDS, BASE_CURRENCY, breakdown, countryLabel, missingRates, type WealthData } from '../model'
import { fmt, pct } from '../format'

const GROUPS: { title: string; key: Parameters<typeof breakdown>[1] }[] = [
  { title: '依資產類別', key: (a) => a.category },
  { title: '依帳戶', key: (a) => a.name },
  { title: '依幣別', key: (_, p) => p.currency },
  { title: '依國家', key: (a) => countryLabel(a.country) },
  { title: '依帳戶類型', key: (a) => ACCOUNT_KINDS[a.kind] },
  { title: '依用途', key: (a) => a.purpose },
]

export function Overview({ data, onGoRates }: { data: WealthData; onGoRates: () => void }) {
  const missing = missingRates(data)
  const { total } = breakdown(data, () => '')

  if (data.accounts.length === 0) return <p className="muted">尚無帳戶，請到「帳戶」分頁新增，或貼上試算表匯入。</p>

  return (
    <>
      <div className="hero">
        <span className="muted">總資產（{BASE_CURRENCY}）</span>
        <strong>{fmt(total, 0)}</strong>
      </div>
      {missing.length > 0 && (
        <p className="warn">
          {missing.join('、')} 尚未設定匯率，這些部位沒有計入總額。
          <button className="link" onClick={onGoRates}>
            設定匯率
          </button>
        </p>
      )}
      <div className="grid">
        {GROUPS.map(({ title, key }) => (
          <section key={title} className="card">
            <h3>{title}</h3>
            <table className="breakdown">
              <tbody>
                {breakdown(data, key).slices.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td className="bar">
                      <span style={{ width: pct(s.share) }} />
                    </td>
                    <td className="num">{fmt(s.value, 0)}</td>
                    <td className="num muted">{pct(s.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </>
  )
}
