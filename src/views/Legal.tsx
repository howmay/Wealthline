// Public notice pages: privacy policy, terms of use and disclaimer. They are reachable
// without signing in, since Google's OAuth consent screen links to the privacy policy.

import type { ReactNode } from 'react'
import { DATA_FILE_NAME, FOLDER_NAME } from '../google/drive'
import { AUTHOR, AUTHOR_URL, ISSUES_URL, LICENSE_URL, LICENSE_ZH_URL, PAGES, REPO_URL, SECURITY_URL, SITE_HOST, SITE_URL, type PageKey } from '../site'
import { Link, Logo, SiteFooter } from './Site'

const EFFECTIVE = '2026 年 10 月 8 日'
const DATA_PATH = `我的雲端硬碟 / ${FOLDER_NAME} / ${DATA_FILE_NAME}`

export function LegalPage({ page, signedIn }: { page: PageKey; signedIn: boolean }) {
  return (
    <div className="legal-page">
      <header className="legal-top">
        <Link to="/" className="brand">
          <Logo />
          <span>Wealthline</span>
        </Link>
        <Link to="/" className="legal-back">
          {signedIn ? '← 回到我的資產' : '← 回到首頁'}
        </Link>
      </header>
      <main className="legal">
        <nav className="legal-tabs" aria-label="公告">
          {(Object.keys(PAGES) as PageKey[]).map((k) => (
            <Link key={k} to={PAGES[k].path} className={k === page ? 'active' : ''} aria-current={k === page ? 'page' : undefined}>
              {PAGES[k].title}
            </Link>
          ))}
        </nav>
        <article>
          <h1>{PAGES[page].title}</h1>
          <p className="muted small">生效日期：{EFFECTIVE}</p>
          {page === 'privacy' && <Privacy />}
          {page === 'terms' && <Terms />}
          {page === 'disclaimer' && <Disclaimer />}
          <p className="legal-contact">
            對本頁內容有任何問題，請到 <a href={ISSUES_URL}>GitHub Issues</a> 提出，或聯絡作者{' '}
            <a href={AUTHOR_URL}>{AUTHOR}</a>。
          </p>
        </article>
      </main>
      <SiteFooter />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Privacy() {
  return (
    <>
      <p className="legal-lead">
        Wealthline（<a href={SITE_URL}>{SITE_HOST}</a>）是一個開放原始碼的個人資產統計工具。我們的設計原則很簡單：<strong>你的資產資料只存在你自己的 Google Drive</strong>，
        作者沒有任何伺服器或資料庫保存它，也看不到它。
      </p>

      <Section title="一、我們取得哪些資料">
        <p>當你以 Google 帳號登入時，你會在 Google 的授權畫面中同意以下權限：</p>
        <ul>
          <li>
            <strong>基本個人資料</strong>（openid、email、profile）：你的名稱、電子郵件與大頭貼，只用來在畫面上顯示目前登入的帳號，以及讓你下次一鍵繼續登入。
          </li>
          <li>
            <strong>Google Drive 的 drive.file 權限</strong>：只能存取本服務自己建立的檔案，或你主動用本服務開啟的檔案。我們<strong>無法</strong>看到、讀取或修改你雲端硬碟中的其他任何檔案。
          </li>
        </ul>
        <p>你在本服務中輸入的帳戶、餘額、持倉、匯率與歷史紀錄，就是你的資產資料。</p>
      </Section>

      <Section title="二、資料存放在哪裡">
        <ul>
          <li>
            資產資料以一個 JSON 檔存放在你的 Google Drive：<code>{DATA_PATH}</code>。你可以隨時在雲端硬碟中查看、下載、備份或刪除它。
          </li>
          <li>
            登入狀態存在你這台裝置瀏覽器的 localStorage：一組約一小時後失效的 Google 存取權杖，以及你的名稱、電子郵件與大頭貼網址。登出時會撤銷權杖並清除這些資料。
          </li>
          <li>本服務沒有後端資料庫，不會把你的資產資料或個人資料傳送、複製或保存到作者控制的任何地方。</li>
        </ul>
      </Section>

      <Section title="三、會連線到哪些第三方服務">
        <p>為了提供功能，你的瀏覽器會直接連線到下列服務，傳送的內容僅限於完成該功能所需：</p>
        <ul>
          <li>
            <strong>Google</strong>（登入、使用者資料、Google Drive API）：讀寫上述資料檔。適用 <a href="https://policies.google.com/privacy">Google 隱私權政策</a>。
          </li>
          <li>
            <strong>報價查詢 /api/quote</strong>：由本服務部署在 Cloudflare Pages 上的小型轉發程式，只會收到<strong>股票代號</strong>（例如 2330.TW），再向 Yahoo Finance 查詢價格。不包含數量、金額或你的身分，程式也不記錄任何內容。
          </li>
          <li>
            <strong>ExchangeRate-API</strong>（open.er-api.com）與 <strong>CoinGecko</strong>：查詢匯率與加密貨幣價格，請求中只有幣別或幣種名稱。
          </li>
          <li>
            <strong>Cloudflare</strong>：網站的託管服務。和任何網站一樣，託管商可能依其政策記錄連線的 IP 位址等技術資訊。
          </li>
        </ul>
      </Section>

      <Section title="四、我們不做的事">
        <ul>
          <li>不使用分析工具、追蹤 Cookie 或廣告。</li>
          <li>不出售、出租或分享你的任何資料。</li>
          <li>不將你的資料用於廣告、信用評估，或訓練任何人工智慧模型。</li>
        </ul>
      </Section>

      <Section title="五、Google API 使用者資料">
        <p>
          Wealthline 對於從 Google API 取得之資訊的使用與傳輸，遵守{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API 服務使用者資料政策</a>
          ，包括其中的「有限使用」（Limited Use）規定。從 Google 取得的資料只用於提供你在畫面上看到的功能。
        </p>
      </Section>

      <Section title="六、你的權利與控制">
        <ul>
          <li>查看與匯出：直接在 Google Drive 開啟或下載資料檔。</li>
          <li>刪除：刪除雲端硬碟中的 {FOLDER_NAME} 資料夾即可完全移除資產資料。</li>
          <li>
            撤銷授權：到 <a href="https://myaccount.google.com/connections">Google 帳戶的第三方連結</a> 移除 Wealthline 的存取權。
          </li>
          <li>
            依中華民國《個人資料保護法》，你可以行使查詢、閱覽、更正、停止處理與刪除等權利。由於作者並未保存你的個人資料，這些權利大多可以直接透過上述方式自行完成；如仍有需要，請透過下方管道聯絡。
          </li>
        </ul>
      </Section>

      <Section title="七、安全">
        <p>
          所有連線都使用 HTTPS。資料檔的保護由 Google Drive 的帳號安全機制負責，請為你的 Google 帳號啟用兩步驟驗證。本服務的程式碼完全公開在{' '}
          <a href={REPO_URL}>GitHub</a>，任何人都可以檢查上述說明是否屬實。
        </p>
      </Section>

      <Section title="八、政策變更">
        <p>本政策如有修改，會更新本頁的生效日期，並可在 GitHub 的版本紀錄中查到每一次的變更內容。</p>
      </Section>
    </>
  )
}

function Terms() {
  return (
    <>
      <p className="legal-lead">使用 Wealthline（<a href={SITE_URL}>{SITE_HOST}</a>，以下稱「本服務」）即表示你同意以下條款。如果不同意，請勿使用本服務。</p>

      <Section title="一、服務內容">
        <p>
          本服務是由個人開發者 {AUTHOR}（以下稱「作者」）以開放原始碼方式提供的免費個人資產統計工具，協助你整理帳戶、持倉與匯率，資料保存在你自己的 Google Drive。本服務為個人專案，不保證持續提供、不保證可用時間，也可能隨時修改或停止。
        </p>
      </Section>

      <Section title="二、帳號與資料責任">
        <ul>
          <li>你需以自己的 Google 帳號登入，並負責保管該帳號的安全。</li>
          <li>你輸入的資料由你自行負責其正確性。資料檔存放在你的 Google Drive，請自行備份；作者無法替你復原遺失或損毀的資料。</li>
          <li>請勿刪除或手動修改資料檔的結構，以免本服務無法讀取。</li>
        </ul>
      </Section>

      <Section title="三、合理使用">
        <p>你同意不以下列方式使用本服務：</p>
        <ul>
          <li>大量或自動化地呼叫報價查詢 /api/quote，或將其作為其他服務的資料來源。</li>
          <li>干擾、破壞本服務或其所使用之第三方服務的正常運作。</li>
          <li>違反中華民國法律或你所在地法律的任何行為。</li>
        </ul>
      </Section>

      <Section title="四、智慧財產權與授權">
        <p>
          本服務的原始碼、圖示與介面設計之著作權屬於作者，依{' '}
          <a href={LICENSE_URL}>PolyForm Noncommercial License 1.0.0</a> 公開授權，並附有
          <a href={LICENSE_ZH_URL}>繁體中文授權說明</a>：個人學習、研究與教育等非商業用途可以自由使用、修改與散布；
          <strong>任何商業用途，須事先取得作者的書面授權</strong>。
        </p>
        <p>Google、Google Drive、Yahoo Finance、CoinGecko、Cloudflare 等名稱與商標屬於其各自的權利人，本服務與其並無合作或背書關係。</p>
      </Section>

      <Section title="五、第三方服務">
        <p>本服務仰賴 Google、Yahoo Finance、ExchangeRate-API、CoinGecko 與 Cloudflare 等第三方服務。你使用這些服務時，也須遵守其各自的條款；第三方服務中斷或變更造成的影響，不在作者的控制範圍內。</p>
      </Section>

      <Section title="六、責任限制">
        <p>
          本服務依「現況」提供，不附帶任何明示或默示的保證。於法律允許的最大範圍內，作者對於因使用或無法使用本服務所生之任何直接或間接損害，不負賠償責任；但依中華民國《民法》第 222 條，因故意或重大過失所生之責任不在此限。本服務不提供投資建議，詳見
          <Link to={PAGES.disclaimer.path}>免責聲明</Link>。
        </p>
      </Section>

      <Section title="七、終止">
        <p>你可以隨時停止使用本服務並撤銷 Google 授權。若你違反本條款，作者得停止你使用本服務的部署版本。</p>
      </Section>

      <Section title="八、準據法與管轄">
        <p>本條款以中華民國法律為準據法。因本條款所生之爭議，雙方同意以臺灣臺北地方法院為第一審管轄法院。</p>
      </Section>

      <Section title="九、條款變更">
        <p>作者可能修改本條款，修改後會更新本頁的生效日期。修改後你繼續使用本服務，即視為同意修改後的條款。</p>
      </Section>
    </>
  )
}

function Disclaimer() {
  return (
    <>
      <p className="legal-lead">Wealthline 是記錄與統計個人資產的工具，不是投資、理財、稅務或法律顧問。</p>

      <Section title="一、非投資建議">
        <p>
          本服務顯示的任何數字、圖表、配置比例或歷史趨勢，僅供你個人記錄與參考，不構成任何投資建議、要約或招攬。作者並非證券投資顧問或任何金融業者。投資有風險，任何決策請自行判斷，必要時諮詢合格的專業人士。
        </p>
      </Section>

      <Section title="二、報價與匯率的正確性">
        <ul>
          <li>股票、基金與加密貨幣價格來自 Yahoo Finance 與 CoinGecko，匯率來自 ExchangeRate-API，皆為免費公開資料，可能延遲（通常為收盤價或每日更新）、不完整或錯誤。</li>
          <li>代號對應（例如 2330 → 2330.TW）由程式自動判斷，可能對應到錯誤的標的，請自行核對；你也可以手動輸入價格與匯率。</li>
          <li>統計結果以新臺幣換算，未計入交易成本、稅負或匯兌手續費，與你在金融機構的實際價值可能不同。</li>
        </ul>
      </Section>

      <Section title="三、資料安全與遺失">
        <p>
          你的資料只存在你的 Google Drive，本服務不另外保存副本。帳號遭盜用、資料檔被刪除或覆寫、第三方服務異常等情況造成的資料遺失或外洩，作者無法負責，請定期下載備份。
        </p>
      </Section>

      <Section title="四、資料來源標示">
        <ul>
          <li>
            匯率：<a href="https://www.exchangerate-api.com">Rates By Exchange Rate API</a>
          </li>
          <li>
            股票與基金報價：<a href="https://finance.yahoo.com">Yahoo Finance</a>
          </li>
          <li>
            加密貨幣價格：<a href="https://www.coingecko.com">CoinGecko</a>
          </li>
        </ul>
      </Section>

      <Section title="五、開放原始碼">
        <p>
          本服務的完整原始碼公開於 <a href={REPO_URL}>GitHub</a>，歡迎任何人審查。發現錯誤請透過 <a href={ISSUES_URL}>Issues</a> 回報；涉及安全漏洞時請勿公開細節，改用 GitHub 的
          <a href={SECURITY_URL}>私下回報安全漏洞</a>功能。
        </p>
      </Section>
    </>
  )
}
