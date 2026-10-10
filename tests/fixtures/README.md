# 合成帳單

所有名稱、交易、金額與密碼均為合成測試資料，不含真實銀行或個人資訊。

- `synthetic-statement.pdf`：五列，包含兩筆完全相同的真實獨立消費、一筆小數、一筆退款與一筆繳款；應解析出四筆。
- `synthetic-statement-encrypted.pdf`：相同內容，以 ReportLab StandardEncryption 128-bit 加密；使用者密碼 `fixture-password`，擁有者密碼 `fixture-owner`。
- `synthetic-statement-cjk.pdf`：繁體中文商家、退款及繳款。以 MSung-Light/CNS1 與 UniCNS-UCS2-H 字元映射產生，應解析出兩筆。
- `synthetic-scan.pdf`：只含圖形、不含文字的 PDF，驗證不把未辨識當成成功匯入。

使用 ReportLab／pypdf 產生固定樣本，正常測試不需要 Python，只使用專案的 PDF.js。瀏覽器流程另外驗證錯誤密碼、解密、預覽編輯、本機儲存及重匯入。
