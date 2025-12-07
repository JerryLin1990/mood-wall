# Mood Wall (每日心情卡片牆)

這是一個簡單的網頁應用程式，讓使用者可以建立、拖曳、儲存心情卡片到 Google Sheets。

## 功能

*   **建立卡片**：輸入文字、上傳圖片（自動壓縮）、選擇心情與樣式。
*   **拖曳排列**：自由在牆上移動卡片，位置會自動儲存，雙擊卡片可以放大。
*   **刪除與儲存**：卡片上有左上右上有兩個按鈕，左上為刪除，右上為儲存。
*   **圖片處理**：前端自動壓縮圖片至指定大小 (預設 100KB)。
*   **環境變數控制**：可透過 `.env` 設定卡片上限與圖片大小限制。
*   **Google Sheets 同步**：所有資料儲存於 Google Sheets，支援多人協作同步。

## 安裝與設定

1.  **安裝依賴**
    ```bash
    npm install
    ```

2.  **設定環境變數**
    複製 `.env.example` 為 `.env` 並填入以下資訊：
    ```bash
    # 伺服器 Port
    PORT=3000
    
    # 限制設定
    MAX_CARDS=7          # 最多允許的卡片數量
    MAX_IMAGE_SIZE_KB=100 # 圖片最大允許大小 (KB)

    # Google Sheets 設定
    GOOGLE_SHEET_ID=你的_SHEET_ID
    GOOGLE_SA_CLIENT_EMAIL=你的服務帳號Email
    GOOGLE_SA_PRIVATE_KEY="你的私鑰(包含-----BEGIN PRIVATE KEY-----)"
    ```

3.  **Google Sheets 準備**
    *   建立一個新的 Google Sheet。

## 安裝與設定

1.  **安裝依賴**
    ```bash
    npm install
    ```

2.  **設定環境變數**
    複製 `.env.example` 為 `.env` 並填入以下資訊：
    ```bash
    # 伺服器 Port
    PORT=3000
    
    # 限制設定
    MAX_CARDS=7          # 最多允許的卡片數量
    MAX_IMAGE_SIZE_KB=100 # 圖片最大允許大小 (KB)

    # Google Sheets 設定
    GOOGLE_SHEET_ID=你的_SHEET_ID
    GOOGLE_SA_CLIENT_EMAIL=你的服務帳號Email
    GOOGLE_SA_PRIVATE_KEY="你的私鑰(包含-----BEGIN PRIVATE KEY-----)"
    ```

3.  **Google Sheets 準備**
    *   建立一個新的 Google Sheet。
    *   分享權限給你的服務帳號 Email (編輯權限)。
    *   工作表名稱 (Tab Name) 必須預設為 `cards`，或修改程式碼中的 `SHEET_NAME`。
    *   第一列 (Header) 必須包含以下欄位 (順序沒關係，但建議如下)：
        `id`, `text`, `mood`, `style`, `header`, `part1`, `part2`, `part3`, `x`, 'y', 'r', 'created_at'

## 執行
 
 ### 開發模式 (推薦)
 ```bash
 npm run dev
 ```
 開發模式支援熱重載 (Hot Reload)，修改後端檔案會自動重啟。
 打開瀏覽器前往 `http://localhost:3000`。
 
 ### 正式執行
 ```bash
 node app.js
 ```
 
 ## 安全性說明
 
 *   **敏感檔案保護**: 系統已實作 Middleware 禁止外部存取 `.env`, `.git` 以及原始碼檔案 (`app.js`, `package.json`)。
 *   **輸入驗證**: 針對傳入 Google Sheets 的文字內容已進行 CSV Injection 防護 (自動跳脫特殊字元)。
  
 ## 專案結構說明
 
 *   `moodwall.html`: 主頁面 HTML，已將 JS 與 CSS 分離。
 *   `style.css`: 獨立的樣式表 (包含 RWD 與動畫)。
 *   `client.js`: 前端互動邏輯 (包含拖曳、圖片壓縮、下載、API 呼叫)。
 *   `app.js`: 後端 Express 伺服器，負責 API、權限控管與靜態檔案服務。
 *   `img/`: 存放靜態圖片資源 (如 icon)。
 
 ## 關於限制 (Frontend vs Backend)
 
 為了確保安全性與一致性，我們對以下限制做了前後端雙重驗證：
 
 1.  **最大卡片數量 (`MAX_CARDS`)**
     *   **前端**: 在點擊「印出卡片」時檢查，若超過數量會 alert 警告並阻止建立。
     *   **後端**: `POST /api/cards` 會先計算資料庫目前筆數，若超過設定值會回傳 `400 Error`。
 
 2.  **圖片大小限制 (`MAX_IMAGE_SIZE_KB`)**
     *   **前端**: 上傳圖片時，會使用 Canvas 遞迴壓縮圖片，直到 size 小於設定值 (預設 100KB)。
     *   **後端**: `POST /api/cards` 會計算上傳的 Base64 字串長度並推算檔案大小，若超過 110% (保留緩衝) 設定值，會拒絕寫入。
