// Public notice pages: privacy policy, terms of use and disclaimer. They are reachable
// without signing in, since Google's OAuth consent screen links to the privacy policy.

import type { ReactNode } from 'react'
import { DATA_FILE_NAME, FOLDER_NAME } from '../google/drive'
import { AUTHOR, ISSUES_URL, LICENSE_URL, LICENSE_ZH_URL, OPERATOR, OPERATOR_URL, PAGES, REPO_URL, SECURITY_URL, SITE_HOST, SITE_URL, type PageKey } from '../site'
import { Link, Logo, SiteFooter } from './Site'

const EFFECTIVE = '2026 年 10 月 9 日'
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
          <h1>
            {PAGES[page].title}
            <span className="legal-h1-en" lang="en">
              Wealthline {PAGES[page].en}
            </span>
          </h1>
          <p className="muted small">生效日期／最後更新：{EFFECTIVE}</p>
          {page === 'privacy' && <Privacy />}
          {page === 'terms' && <Terms />}
          {page === 'disclaimer' && <Disclaimer />}
          <p className="legal-contact">
            對本頁內容有任何問題，請到 <a href={ISSUES_URL}>GitHub Issues</a> 提出，或聯絡營運者{' '}
            <a href={OPERATOR_URL}>{OPERATOR}</a>。
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

const SCOPES = [
  { scope: 'openid', zh: '確認你的 Google 帳號身分', en: 'Confirms which Google account signed in' },
  {
    scope: 'https://www.googleapis.com/auth/userinfo.email',
    zh: '讀取你的電子郵件地址，顯示目前登入的帳號，並讓你下次一鍵繼續登入',
    en: 'Reads your email address to show which account is signed in and to offer one-click sign-in next time',
  },
  {
    scope: 'https://www.googleapis.com/auth/userinfo.profile',
    zh: '讀取你的名稱與大頭貼，顯示在右上角的帳號選單',
    en: 'Reads your name and profile picture to show them in the account menu',
  },
  {
    scope: 'https://www.googleapis.com/auth/drive.file',
    zh: `在你的 Google Drive 建立「${FOLDER_NAME}」資料夾與 ${DATA_FILE_NAME} 資料檔，並讀取、更新這個檔案。只能存取本服務建立的檔案，看不到你雲端硬碟中的其他檔案`,
    en: `Creates the "${FOLDER_NAME}" folder and the ${DATA_FILE_NAME} file in your Google Drive, then reads and updates that file. It can only access files this app created and cannot see any other file in your Drive`,
  },
]

function Privacy() {
  return (
    <>
      <PrivacyEnglish />
      <h2 className="legal-zh-title">中文版</h2>
      <p className="legal-lead">
        Wealthline（<a href={SITE_URL}>{SITE_HOST}</a>）是一個開放原始碼的個人資產統計工具，讓你記錄銀行存款、股票、基金與加密貨幣，並換算成新臺幣看清資產配置。
        我們的設計原則很簡單：<strong>你的資產資料只存在你自己的 Google Drive</strong>，營運者沒有任何伺服器或資料庫保存它，也看不到它。
        本政策說明本服務存取哪些資料、如何使用、存放、分享與刪除。英文版本在本頁上方，兩者內容相同。
      </p>

      <Section title="一、適用範圍與聯絡方式">
        <p>
          本政策適用於 <a href={SITE_URL}>{SITE_URL}</a> 上的 Wealthline 網頁應用程式。本服務由 GitHub 組織 <a href={OPERATOR_URL}>{OPERATOR}</a>（以下稱「營運者」）營運與維護，聯絡方式為{' '}
          <a href={ISSUES_URL}>GitHub Issues</a> 或 <a href={OPERATOR_URL}>{OPERATOR_URL}</a>。
        </p>
      </Section>

      <Section title="二、我們向 Google 要求的權限">
        <p>以 Google 帳號登入時，Google 會顯示授權畫面，請你同意以下權限。每個權限的用途如下：</p>
        <ScopeTable lang="zh" />
        <p>本服務不會要求其他任何 Google 權限，例如 Gmail、通訊錄、日曆，或讀取整個雲端硬碟的權限。</p>
      </Section>

      <Section title="三、我們存取與處理哪些資料">
        <ul>
          <li>
            <strong>Google 帳號基本資料</strong>：帳號識別碼、電子郵件、名稱、大頭貼網址。用途：核對重新授權的帳號、顯示登入身分、一鍵繼續登入。
          </li>
          <li>
            <strong>Google 存取權杖</strong>：Google 發給本服務、約一小時後失效的權杖，用來代表你呼叫 Google Drive API。
          </li>
          <li>
            <strong>你輸入的資產資料</strong>：帳戶名稱、類型、國家、各幣別餘額、持有標的代號與數量、匯率、每日資產快照、標的加入日期與修改紀錄。用途：計算與呈現你的資產統計。
          </li>
        </ul>
        <p>本服務不蒐集你的銀行帳號、密碼、身分證字號、交易憑證或任何金融機構的登入資訊。</p>
      </Section>

      <Section title="四、資料如何使用">
        <p>上述資料只用於提供你在畫面上看到的功能：登入、讀寫你的資料檔、計算總資產與資產配置、顯示歷史走勢。我們不會：</p>
        <ul>
          <li>出售、出租或與任何第三方分享你的資料；</li>
          <li>將資料用於廣告、行銷、信用評估或建立使用者檔案；</li>
          <li>將資料用於訓練任何人工智慧或機器學習模型；</li>
          <li>讓任何人（包括營運者）閱讀你的資料。</li>
        </ul>
      </Section>

      <Section title="五、資料存放在哪裡、保存多久">
        <ul>
          <li>
            <strong>資產資料</strong>：以 JSON 檔存放在你的 Google Drive：<code>{DATA_PATH}</code>。由你自己保管，直到你刪除它為止。
          </li>
          <li>
            <strong>登入資訊</strong>：存取權杖只存放在目前分頁的 sessionStorage：重新整理頁面仍保持登入，關閉分頁或瀏覽器即失去，也不會與其他分頁共用。localStorage 只保存帳號識別碼、電子郵件、名稱與大頭貼網址，供下次繼續登入，另記錄你最後看過的隱私權政策版本。登出立即清除本機登入資訊，並嘗試向 Google 撤銷權杖；若網路失敗，可至 Google 帳戶撤銷授權。
          </li>
          <li>
            <strong>營運者的伺服器</strong>：沒有。本服務沒有後端資料庫，不會把你的資產資料或個人資料傳送、複製或保存到營運者控制的任何地方。
          </li>
        </ul>
      </Section>

      <Section title="六、資料傳送給哪些第三方">
        <p>你的瀏覽器會直接連線到下列服務，傳送的內容僅限於完成該功能所需：</p>
        <ul>
          <li>
            <strong>Google</strong>（登入、使用者資料、Google Drive API）：讀寫你的資料檔。適用 <a href="https://policies.google.com/privacy">Google 隱私權政策</a>。
          </li>
          <li>
            <strong>報價查詢 /api/quote 與 /api/history</strong>：本服務部署在 Cloudflare Workers 上的轉發程式，只收到<strong>股票或匯率代號</strong>（例如 2330.TW、USDTWD=X），查歷史價格時另有一個起始日期，再向 Yahoo Finance 查詢價格。不包含數量、金額或你的身分，也不記錄任何內容。
          </li>
          <li>
            <strong>ExchangeRate-API</strong>（open.er-api.com）與 <strong>CoinGecko</strong>：查詢匯率與加密貨幣價格，請求中只有幣別或幣種名稱。
          </li>
          <li>
            <strong>Cloudflare</strong>：網站託管服務。和任何網站一樣，託管商可能依其政策記錄連線的 IP 位址等技術資訊。
          </li>
        </ul>
        <p>從 Google API 取得的資料（包括你的帳號資料與 Drive 檔案內容）不會傳送給上述 Google 以外的任何服務。</p>
      </Section>

      <Section title="七、Google API 使用者資料：有限使用聲明">
        <p>
          Wealthline 對於從 Google API 取得之資訊的使用與傳輸，遵守{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API 服務使用者資料政策</a>
          ，包括其中的「有限使用」（Limited Use）規定。從 Google 取得的資料只用於提供或改善使用者看得到的功能；不會轉讓給第三方；不會用於廣告；除非取得你的明確同意、基於安全目的或為遵守法律，任何人都不會閱讀這些資料。
        </p>
      </Section>

      <Section title="八、如何刪除資料與撤銷授權">
        <ul>
          <li>
            <strong>刪除資產資料</strong>：在 Google Drive 刪除「{FOLDER_NAME}」資料夾並清空垃圾桶，資料即完全移除。營運者沒有副本，無需另外申請。
          </li>
          <li>
            <strong>清除本機登入資訊</strong>：在本服務中按「登出」，或清除瀏覽器的網站資料。
          </li>
          <li>
            <strong>撤銷 Google 授權</strong>：到 <a href="https://myaccount.google.com/connections">Google 帳戶的第三方連結</a> 移除 Wealthline 的存取權。
          </li>
          <li>
            依中華民國《個人資料保護法》，你可以行使查詢、閱覽、更正、停止處理與刪除等權利。由於營運者並未保存你的個人資料，這些權利大多可以透過上述方式自行完成；如仍有需要，請透過第一節的管道聯絡。
          </li>
        </ul>
      </Section>

      <Section title="九、Cookie 與追蹤">
        <p>本服務不使用 Cookie、分析工具、廣告或任何追蹤技術。localStorage 與 sessionStorage 只用來保存上述登入資訊與你最後看過的隱私權政策版本。</p>
      </Section>

      <Section title="十、安全">
        <p>
          正式網站連線使用 HTTPS。資料檔由 Google Drive 的帳號安全機制保護，請為你的 Google 帳號啟用兩步驟驗證。本服務的程式碼完全公開在{' '}
          <a href={REPO_URL}>GitHub</a>，任何人都可以檢查上述說明是否屬實。
        </p>
      </Section>

      <Section title="十一、兒童">
        <p>本服務不以兒童為對象，也不會在知情的情況下處理兒童的個人資料。</p>
      </Section>

      <Section title="十二、政策變更">
        <p>
          本政策如有修改，會更新本頁的「最後更新日期」，並可在 GitHub 的版本紀錄中查到每一次的變更內容。若修改內容涉及 Google 使用者資料的存取、使用、存放或分享方式，登入後的 App 內會顯示通知並連到新版政策；以新的方式使用 Google 使用者資料前，會再次取得你的同意。
        </p>
      </Section>

    </>
  )
}

function ScopeTable({ lang }: { lang: 'zh' | 'en' }) {
  return (
    <div className="table-wrap">
      <table className="scope-table">
        <thead>
          <tr>
            <th>{lang === 'zh' ? '權限（Scope）' : 'Scope'}</th>
            <th>{lang === 'zh' ? '用途' : 'Why Wealthline needs it'}</th>
          </tr>
        </thead>
        <tbody>
          {SCOPES.map((s) => (
            <tr key={s.scope}>
              <td>
                <code>{s.scope}</code>
              </td>
              <td>{s[lang]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PrivacyEnglish() {
  return (
    <section className="legal-en" lang="en" id="english">
      <h2>Wealthline Privacy Policy (English)</h2>
      <p className="muted small">Effective date: October 8, 2026 · Last updated: October 9, 2026 · App: Wealthline · Website: {SITE_URL} · Operator: {OPERATOR} ({OPERATOR_URL})</p>
      <p>
        This privacy policy explains how <strong>Wealthline</strong> (<a href={SITE_URL}>{SITE_HOST}</a>), a free, open-source personal asset tracking web app,
        accesses, uses, stores, shares and deletes Google user data. Wealthline lets you record bank balances, stocks, funds and crypto holdings and shows your
        total net worth and asset allocation. <strong>All of your data is stored only in your own Google Drive.</strong> Wealthline has no backend database,
        and its operator cannot see your data.
      </p>

      <h3>1. Google user data we access</h3>
      <p>When you sign in with Google, Wealthline requests only these scopes:</p>
      <ScopeTable lang="en" />
      <p>From these scopes Wealthline accesses:</p>
      <ul>
        <li>your Google account <strong>identifier, email address, name and profile picture URL</strong>; the identifier verifies the account on reauthorization;</li>
        <li>
          the <strong>single data file</strong> that Wealthline creates in your Google Drive (<code>My Drive / {FOLDER_NAME} / {DATA_FILE_NAME}</code>),
          which holds the accounts, balances, holdings, exchange rates, daily snapshots, the date each holding was added, and the edit log that you enter;
        </li>
        <li>a short-lived <strong>OAuth access token</strong> (about one hour) used to call the Google Drive API on your behalf.</li>
      </ul>
      <p>Wealthline does not access Gmail, Contacts, Calendar or any other file in your Google Drive.</p>

      <h3>2. How we use Google user data</h3>
      <p>Google user data is used only to provide the features you see in the app:</p>
      <ul>
        <li>your email, name and picture are shown in the account menu so you know which account is signed in, and your email lets you sign in again with one click;</li>
        <li>the Drive file is read to display your asset statistics and written when you press “Save”.</li>
      </ul>
      <p>
        Wealthline does not use Google user data for advertising, does not sell it, does not use it for credit or lending decisions, does not build user
        profiles or databases from it, and does not let any person read it. Wealthline does not use Google user data, including data obtained through
        Google Workspace APIs, to develop, improve or train generalized or non-personalized AI or machine learning models.
      </p>

      <h3>3. How we share, transfer or disclose Google user data</h3>
      <p>
        <strong>We do not share, transfer or disclose Google user data with any third party.</strong> Google user data travels only between your browser
        and Google. To look up market prices, the browser sends only ticker or currency-pair symbols (for example 2330.TW or USDTWD=X), plus a start date for past prices, to the
        app's own quote relay on Cloudflare Workers, which asks Yahoo Finance, and only currency or coin codes to ExchangeRate-API and CoinGecko. These requests contain no Google user data, no
        amounts and no identity. Cloudflare hosts the website and may log technical data such as IP addresses under its own policy.
      </p>

      <h3>4. How we store and protect Google user data</h3>
      <ul>
        <li>Your asset data is stored in your own Google Drive and protected by your Google account's security. Wealthline keeps no copy on any server.</li>
        <li>
          The access token is kept only in the current tab's sessionStorage: it survives a reload but is lost when the tab or browser is closed, and is not shared with other tabs. Your account identifier, email, name and picture URL
          are kept in localStorage as a hint for your next sign-in, along with the version of this policy you last saw.
        </li>
        <li>All traffic between your browser, Google and Wealthline uses HTTPS (TLS) encryption.</li>
        <li>Wealthline only requests the narrow drive.file scope, so it cannot reach your other files.</li>
        <li>
          The full source code is public on <a href={REPO_URL}>GitHub</a>, so anyone can verify these statements.
        </li>
      </ul>

      <h3>5. Data retention and deletion</h3>
      <ul>
        <li>The Drive data file stays in your Drive until you delete it. Delete the "{FOLDER_NAME}" folder and empty the trash to remove it completely.</li>
        <li>
          The account hint stays in your browser until you sign out. Signing out immediately clears local sign-in information and attempts to revoke
          the token with Google. If that request fails, you can revoke access in your Google account. Clearing browser site data also removes the hint.
        </li>
        <li>
          You can revoke Wealthline's access at any time at{' '}
          <a href="https://myaccount.google.com/connections">Google Account → Third-party apps &amp; services</a>.
        </li>
        <li>
          Because the operator stores none of your data, there is nothing to delete on our side. If you have a deletion or privacy request, open an issue
          at <a href={ISSUES_URL}>GitHub Issues</a> or contact the operator, the {OPERATOR} organization, at <a href={OPERATOR_URL}>{OPERATOR_URL}</a>.
        </li>
      </ul>

      <h3>6. Limited Use disclosure</h3>
      <p>
        Wealthline's use and transfer to any other app of information received from Google APIs will adhere to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use
        requirements.
      </p>

      <h3>7. Cookies and tracking</h3>
      <p>Wealthline uses no cookies, analytics, advertising or tracking technologies. It uses browser storage only for the sign-in information described above and the version of this policy you last saw.</p>

      <h3>8. Children</h3>
      <p>Wealthline is not directed at children under 13 and does not knowingly process their personal data.</p>

      <h3>9. Changes to this policy</h3>
      <p>
        When this policy changes, we update the "Last updated" date above, and every change is visible in the public GitHub history. If a change affects how
        Wealthline accesses, uses, stores or shares Google user data, signed-in users see a notice inside the app that links to the updated policy, and we
        will ask for your consent again before using Google user data in a new way.
      </p>

      <h3>10. Contact</h3>
      <p>
        Operator: the {OPERATOR} GitHub organization (<a href={OPERATOR_URL}>{OPERATOR_URL}</a>). Contact: <a href={ISSUES_URL}>GitHub Issues</a>.
      </p>
    </section>
  )
}

function Terms() {
  return (
    <>
      <p className="legal-lead">使用 Wealthline（<a href={SITE_URL}>{SITE_HOST}</a>，以下稱「本服務」）即表示你同意以下條款。如果不同意，請勿使用本服務。</p>

      <Section title="一、服務內容">
        <p>
          本服務是由 GitHub 組織 {OPERATOR}（<a href={OPERATOR_URL}>{OPERATOR_URL}</a>，以下稱「營運者」）以開放原始碼方式提供的免費個人資產統計工具，協助你整理帳戶、持倉與匯率，資料保存在你自己的 Google Drive。本服務為開源專案，不保證持續提供、不保證可用時間，也可能隨時修改或停止。
        </p>
      </Section>

      <Section title="二、帳號與資料責任">
        <ul>
          <li>你需以自己的 Google 帳號登入，並負責保管該帳號的安全。</li>
          <li>你輸入的資料由你自行負責其正確性。資料檔存放在你的 Google Drive，請自行備份；營運者無法替你復原遺失或損毀的資料。</li>
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
          本服務的原始碼、圖示與介面設計之著作權屬於作者 {AUTHOR}，依{' '}
          <a href={LICENSE_URL}>PolyForm Noncommercial License 1.0.0</a> 公開授權，並附有
          <a href={LICENSE_ZH_URL}>繁體中文授權說明</a>：個人學習、研究與教育等非商業用途可以自由使用、修改與散布；
          <strong>任何商業用途，須事先取得作者的書面授權</strong>。
        </p>
        <p>Google、Google Drive、Yahoo Finance、CoinGecko、Cloudflare 等名稱與商標屬於其各自的權利人，本服務與其並無合作或背書關係。</p>
      </Section>

      <Section title="五、第三方服務">
        <p>本服務仰賴 Google、Yahoo Finance、ExchangeRate-API、CoinGecko 與 Cloudflare 等第三方服務。你使用這些服務時，也須遵守其各自的條款；第三方服務中斷或變更造成的影響，不在營運者的控制範圍內。</p>
      </Section>

      <Section title="六、責任限制">
        <p>
          本服務依「現況」提供，不附帶任何明示或默示的保證。於法律允許的最大範圍內，營運者對於因使用或無法使用本服務所生之任何直接或間接損害，不負賠償責任；但依中華民國《民法》第 222 條，因故意或重大過失所生之責任不在此限。本服務不提供投資建議，詳見
          <Link to={PAGES.disclaimer.path}>免責聲明</Link>。
        </p>
      </Section>

      <Section title="七、終止">
        <p>你可以隨時停止使用本服務並撤銷 Google 授權。若你違反本條款，營運者得停止你使用本服務的部署版本。</p>
      </Section>

      <Section title="八、準據法與管轄">
        <p>本條款以中華民國法律為準據法。因本條款所生之爭議，雙方同意以臺灣臺北地方法院為第一審管轄法院。</p>
      </Section>

      <Section title="九、條款變更">
        <p>營運者可能修改本條款，修改後會更新本頁的生效日期。修改後你繼續使用本服務，即視為同意修改後的條款。</p>
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
          本服務顯示的任何數字、圖表、配置比例或歷史趨勢，僅供你個人記錄與參考，不構成任何投資建議、要約或招攬。營運者並非證券投資顧問或任何金融業者。投資有風險，任何決策請自行判斷，必要時諮詢合格的專業人士。
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
          你的資料只存在你的 Google Drive，本服務不另外保存副本。帳號遭盜用、資料檔被刪除或覆寫、第三方服務異常等情況造成的資料遺失或外洩，營運者無法負責，請定期下載備份。
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
