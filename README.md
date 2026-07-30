# Pocket PDF

手機優先的單頁 PWA PDF Reader MVP。PDF Blob 與閱讀位置只儲存在目前瀏覽器的 IndexedDB；沒有後端，也不會把 Google access token 寫入持久化儲存。

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
- `src/features/reader/`：React-PDF、TanStack Virtual、縮放與 debounce 續讀。
- `src/storage/`：`idb` schema、單一 active document 與 reading progress。
- `src/services/googleDrive.ts`：帶 memory-only Bearer token 的 Drive API 下載。
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
```

重啟 Vite。未設定這兩個值時，Google Drive 按鈕會保持 disabled，本機 PDF 仍可完整使用。

參考：[Google Picker web guide](https://developers.google.com/workspace/drive/picker/guides/web-picker)、[OAuth Web client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)、[`drive.file` scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。

## 手機測試與安裝

一般閱讀流程可在同一 Wi-Fi 下用 `npm run dev -- --host 0.0.0.0`，再從手機開啟電腦的區網 IP。Service worker 與安裝流程需要安全來源；完整 PWA 測試應使用 HTTPS 靜態部署，或受信任的 HTTPS tunnel 指向 `npm run preview -- --host 0.0.0.0`。

在 Chrome/Edge Android 選「新增至主畫面」或「安裝應用程式」；Safari iOS 使用分享選單的「加入主畫面」。先在線上匯入 PDF，等待解析完成，再切離線模式重新開啟；app shell 由 service worker 提供，PDF Blob 從 IndexedDB 讀取。

## MVP 限制

- 一次只保留一份 active PDF。
- 不支援密碼或加密 PDF。
- 不提供 pinch-to-zoom、文字搜尋、文字層或註解層。
- Google token 不續期；過期後需重新開啟 Picker。
- Google OAuth 與 Picker 必須在實際 Google Cloud credentials 下手動驗證。
