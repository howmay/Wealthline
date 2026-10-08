# we-wealth

個人資產服務：以 Google 帳號登入，所有資料都存放在使用者自己的 Google Drive，並清楚呈現資產統計。

- 前端 SPA：Vite + React + TypeScript，不保存任何使用者資料。唯一的伺服器端程式是報價查詢 `/api/quote`（Cloudflare Pages Function，本機開發時由 Vite 提供），只轉發股票代號給 Yahoo Finance。
- 登入：Google Identity Services（OAuth 2.0 token model），access token 只存在記憶體中。
- 儲存：`drive.file` 範圍，資料檔在使用者 Drive 的 `We Wealth/we-wealth-data.json`，使用者可以直接看到、下載或刪除。

## 開始開發

1. 依照 [docs/google-cloud-setup.md](docs/google-cloud-setup.md) 建立 Google Cloud OAuth 用戶端 ID。
2. 設定環境變數並啟動：

   ```bash
   cp .env.example .env.local   # 填入 VITE_GOOGLE_CLIENT_ID
   npm install
   npm run dev                  # http://localhost:5173
   ```

## 指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 本機開發伺服器 |
| `npm run build` | 型別檢查並建置到 `dist/` |
| `npm run preview` | 預覽建置結果 |
| `npm run lint` | oxlint |

## 程式結構

| 路徑 | 內容 |
| --- | --- |
| `src/google/auth.ts` | 載入 GIS、取得／撤銷 access token、讀取使用者資料 |
| `src/google/drive.ts` | 在 Drive 中尋找、建立、讀取、覆寫資料檔 |
| `src/model.ts` | 資料檔格式（帳戶、餘額／持倉、匯率）、讀取驗證與統計函式 |
| `src/quotes.ts`、`server/yahoo.ts`、`functions/api/quote.ts` | 持倉報價：代號轉換（2330 → 2330.TW、BTC → BTC-USD）與 Yahoo Finance 查詢 |
| `src/rates.ts` | 匯率：ExchangeRate-API（法幣）與 CoinGecko（穩定幣、加密貨幣） |
| `src/history.ts` | 歷史：每次儲存記下被修改的餘額／持倉（修改前後的值），以及當天各帳戶、各類別的台幣價值 |
| `src/importSheet.ts` | 從試算表貼上的資料列匯入帳戶與匯率 |
| `src/App.tsx` | 登入流程、分頁與儲存 |
| `src/views/` | 總覽、帳戶、歷史、匯率四個分頁 |

## 資料模型

- **帳戶**：名稱、類型（銀行帳戶／投資帳戶）、國家、資產類別。
- **銀行帳戶**記錄各幣別餘額；**投資帳戶**記錄可用金額（各幣別現金）與持有標的。新增標的只需代號和數量，價格與幣別自動查詢；查不到時可以手動輸入。
- **匯率**：每 1 單位外幣兌台幣，統計時全部換算成台幣。
