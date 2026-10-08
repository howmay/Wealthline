# we-wealth

個人資產服務：以 Google 帳號登入，所有資料都存放在使用者自己的 Google Drive，並清楚呈現資產統計。

- 純前端 SPA：Vite + React + TypeScript，沒有後端，也不保存任何使用者資料。
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
| `src/importSheet.ts` | 從試算表貼上的資料列匯入帳戶與匯率 |
| `src/App.tsx` | 登入流程、分頁與儲存 |
| `src/views/` | 總覽、帳戶、匯率三個分頁 |

## 資料模型

- **帳戶**：名稱、類型（銀行帳戶／投資帳戶）、國家、資產類別、用途。
- **銀行帳戶**記錄各幣別餘額；**投資帳戶**記錄可用金額（各幣別現金）與持有標的（代號、數量、單價、幣別）。
- **匯率**：每 1 單位外幣兌台幣，統計時全部換算成台幣。
