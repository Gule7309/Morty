# Pocket PDF

手機優先的 PWA PDF Reader。登入後，PDF 原始檔保存在私有 Cloudflare R2、metadata 與每位使用者 quota 保存在 D1；IndexedDB 只保存使用者實際開啟過的文件，作為此裝置的離線 cache。Google access token 與 ID token 都只留在記憶體。

## 開始使用

需要 Node.js 22 或相容版本。

```bash
npm install
npm run dev
```

品質檢查：

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

## 架構

- `src/app/App.tsx`：啟動恢復、匯入與 reader/empty state 切換。
- `src/features/import/`：本機 PDF 驗證與官方 Google Drive Picker wrapper。
- `src/features/library/`：從 API 顯示實際容量、文件上限與雲端文件清單。
- `src/features/reader/`：React-PDF、TanStack Virtual、縮放與 debounce 續讀。
- `src/storage/`：`idb` schema、目前 active document cache 與 reading progress。
- `src/services/googleDrive.ts`：帶 memory-only Bearer token 的 Drive API 下載。
- `src/services/cloudStorage.ts`：upload intent、R2 直傳、完成結算與雲端文件 API。
- `worker/`：Google ID token 驗證、quota service、R2 presigned URL、cleanup 與 reconciliation。
- `migrations/`：D1 schema、indexes 及原子 quota triggers。
- `vite.config.ts`：PWA manifest、app-shell precache 與更新處理。

TanStack Virtual 只 mount viewport 附近頁面，`overscan` 為 2。每頁 render 後以 `measureElement` 回報實際高度；手機旋轉或 zoom 改變時重新量測。React-PDF canvas 的 device pixel ratio 上限為 2。

## Google Drive 設定

1. 在 Google Cloud 建立或選擇 project。
2. 啟用 Google Picker API 與 Google Drive API。
3. 在 Google Auth Platform 設定 OAuth consent screen；測試模式下加入自己的 Google 帳號為 test user。
4. 建立 Web application OAuth client，加入 `http://localhost:5173` 與實際部署網址到 Authorized JavaScript origins。
5. 在 consent screen 的 Data Access 加入非敏感 scope `https://www.googleapis.com/auth/drive.file`。
6. Cloud project number 是 Picker 使用的 App ID；OAuth Web client ID 是 Client ID。
7. 複製 `.env.example` 為 `.env.local` 並填入：

```dotenv
VITE_GOOGLE_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
VITE_GOOGLE_APP_ID=your-cloud-project-number
VITE_API_BASE_URL=http://localhost:8787
```

重啟 Vite。未設定 Google client ID 時，雲端匯入按鈕會保持 disabled；既有 IndexedDB cache 仍可離線閱讀。

參考：[Google Picker web guide](https://developers.google.com/workspace/drive/picker/guides/web-picker)、[OAuth Web client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)、[`drive.file` scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。

## Cloudflare 儲存設定

完整 bindings、secrets、migration、R2 CORS、staging 測試方式與 API contract 請見 [`docs/cloud-storage.md`](docs/cloud-storage.md)。`npm test` 使用本機 workerd、D1 與 R2 bindings；瀏覽器端 presigned PUT/GET 必須另外用隔離的 Cloudflare staging bucket 做端到端驗證。

## 手機測試與安裝

一般閱讀流程可在同一 Wi-Fi 下用 `npm run dev -- --host 0.0.0.0`，再從手機開啟電腦的區網 IP。Service worker 與安裝流程需要安全來源；完整 PWA 測試應使用 HTTPS 靜態部署，或受信任的 HTTPS tunnel 指向 `npm run preview -- --host 0.0.0.0`。

在 Chrome/Edge Android 選「新增至主畫面」或「安裝應用程式」；Safari iOS 使用分享選單的「加入主畫面」。先在線上登入並開啟 PDF，等待 IndexedDB cache 完成，再切離線模式重新開啟；app shell 由 service worker 提供，已開啟過的 PDF Blob 從 IndexedDB 讀取。瀏覽器清除 IndexedDB 不會刪除 R2 原始檔。

## MVP 限制

- 每台裝置一次只 cache 一份 active PDF；雲端文件庫可保存多份文件。
- 不支援密碼或加密 PDF。
- 不提供 pinch-to-zoom、文字搜尋、文字層或註解層。
- Google token 不續期；ID token 過期或頁面重載後需重新登入，Drive access token 過期後需重新開啟 Picker。
- Google OAuth 與 Picker 必須在實際 Google Cloud credentials 下手動驗證。
- R2 presigned URL 依靠 bucket-scoped S3 API token；不可把 access key 放進 `VITE_*` 變數。
