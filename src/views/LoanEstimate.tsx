import { useMemo, useState } from 'react'
import { estimateLoan, REPAYMENT_METHODS, type AmortizingMethod } from '../loanEstimate'
import { fmt } from '../format'

const PAGE_SIZE = 12
export function LoanProjection({ principal, annualRate, periods, method, currency }: {
  principal?: number; annualRate?: number; periods?: number; method: AmortizingMethod; currency: string
}) {
  const [page, setPage] = useState(0)
  const result = useMemo(() => {
    if (principal === undefined || annualRate === undefined || periods === undefined) return null
    try { return { estimate: estimateLoan({ principal, annualRate, periods, method }) } }
    catch (e) { return { error: e instanceof Error ? e.message : '無法試算' } }
  }, [principal, annualRate, periods, method])
  if (!result) return <p className="muted small">填入目前剩餘本金、年利率與剩餘期數，即可查看試算。</p>
  if ('error' in result) return <p className="notice" role="status">試算：{result.error}</p>
  const { estimate } = result
  const maxPage = Math.ceil(estimate.rows.length / PAGE_SIZE) - 1
  const currentPage = Math.min(page, maxPage)
  const money = (value: number) => `${currency} ${fmt(value, 2)}`
  return <section className="loan-projection" aria-label="貸款試算">
    <h4>試算 · {REPAYMENT_METHODS[method]}</h4>
    <p className="muted small">按月繳款，假設年利率固定不變、無寬限期、無提前還款及額外費用。銀行依實際日數、調息及尾差可能不同。</p>
    <dl className="liability-details">
      {estimate.regularPayment !== null ? <><dt>預估每月應付</dt><dd>{money(estimate.regularPayment)}（最後一期可能有尾差）</dd></> : <>
        <dt>預估首期應付</dt><dd>{money(estimate.rows[0].payment)}</dd>
        <dt>預估末期應付</dt><dd>{money(estimate.rows.at(-1)!.payment)}（本金固定，利息隨餘額下降；0% 時不變）</dd>
      </>}
      <dt>剩餘總利息</dt><dd>{money(estimate.totalInterest)}</dd>
      <dt>剩餘本息合計</dt><dd>{money(estimate.totalPayment)}</dd>
    </dl>
    <p className="notice small">僅供試算，不會隨日期自動修改實際欠款或淨資產。實際還款後請自行更新本金與剩餘期數。</p>
    <details>
      <summary>查看每期本金、利息與預估期末本金</summary>
      <p className="muted small">期數從下一期起算；表格可左右滑動。金額顯示至小數 2 位，各欄獨立四捨五入，顯示加總可能有尾差。</p>
      <div className="scroll loan-schedule" tabIndex={0} role="region" aria-label="逐期攤還試算表（可橫向捲動）">
        <table className="data"><thead><tr><th>期數</th><th className="num">應付</th><th className="num">本金</th><th className="num">利息</th><th className="num">期末本金</th></tr></thead>
          <tbody>{estimate.rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((row) => <tr key={row.period}>
            <td>{row.period}</td><td className="num">{fmt(row.payment, 2)}</td><td className="num">{fmt(row.principal, 2)}</td><td className="num">{fmt(row.interest, 2)}</td><td className="num">{fmt(row.closingBalance, 2)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {maxPage > 0 && <div className="row loan-pages"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>前 12 期</button><span className="small">第 {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, estimate.rows.length)} 期／共 {estimate.rows.length} 期</span><button type="button" disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>後 12 期</button></div>}
    </details>
    <p className="muted small"><a href="https://www.landbank.com.tw/Calculate/Repayment" target="_blank" rel="noreferrer">公式參考：土地銀行</a></p>
  </section>
}
