# Voice Lab — 免費 GitHub Pages 瀏覽器版

這是獨立版本，不需啟動原專案的 Python / Mac 服務。網站只提供靜態檔案；**每位訪客使用自己的 CPU、RAM 與瀏覽器儲存空間**下載及執行模型，產生的 WAV 可直接下載。沒有推論 API、GPU / WebGPU / Metal 或付費雲端服務。

第一次開啟會自動下載 **Pocket TTS 2M，約 48.9 MiB**，另需下載約十多 MiB 的 CPU 執行程式。其他模型由使用者選擇後下載；模型參數量不是實際下載大小。首頁的「查看全部 15 個模型」會顯示每個模型的精確下載大小及保存狀態。

## 部署到 GitHub Pages

1. 建立一個 **公開** GitHub repository，預設分支使用 `main`。
2. 將**本資料夾裡的內容**放進 repository 根目錄。務必包含 `.github/workflows/pages.yml`、`public/packs/`、`pnpm-lock.yaml`；不要上傳原專案、`node_modules`、`.research` 或 `dist`。ZIP 內有隱藏檔，建議解壓後用 GitHub Desktop 推送，避免網頁逐檔上傳的限制。
3. 到 repository **Settings → Pages → Build and deployment → Source → GitHub Actions**。
4. 推送 `main` 後，Actions 裡的 **Deploy free browser TTS to GitHub Pages** 會自動安裝依賴、驗證、建置、部署。必要時選 **Run workflow** 手動執行。
5. 完成後到 Pages 頁面或 workflow 的 `github-pages` environment 開啟網站，例如 `https://你的帳號.github.io/你的repo/`。

流程會自動處理 repository 子路徑；帳號首頁 `帳號.github.io` repository 也可使用。第一次開啟時網站會自動重新整理一次，建立多執行緒所需的瀏覽器隔離。**不要用 `file://` 直接開啟 index.html。**

GitHub Pages 可免費託管公開 repository 的靜態網站；標準 GitHub-hosted Actions runner 對公開 repository 免費。本包靜態資產約 338 MiB，建置結果約 372 MiB，低於 Pages 的 1 GB 上限；每個資產分片最多 48 MiB，不需要 Git LFS 或付費模型託管帳號。Pages 有每月 100 GB 的軟性流量限制，免費不代表無限資源。部署 artifact 設定保存一天。

官方說明：[Pages 類型及免費方案](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[Actions 計費](https://docs.github.com/en/actions/concepts/billing-and-usage)。

## 模型與 CPU

| 選項 | 下載量約 MiB | 目前整合 | 推論執行緒 |
| --- | ---: | --- | ---: |
| Pocket TTS 2M（預設） | 48.9 | 英文、八個聲音 | 2 |
| Pocket TTS 7M | 71.9 | 英文、八個聲音 | 2 |
| Pocket TTS 18M | 139.7 | 英文、八個聲音 | 2 |
| Pocket TTS 100M | 274.0 | 英文、八個聲音 | 2 |
| Kokoro 82M | 91.6 | 英文、七個聲音、INT8 | 2 |
| Kitten Nano / Micro / Mini | 26.4 / 42.6 / 77.8 | 英文、八個聲音 | 2 |
| Piper Lessac Medium | 60.3 | 英文、單聲音 | 2 |
| Supertonic 3 | 382.7 | 31 種語言、不含中文、十個聲音 | 2 |
| Phonon 31M | 62.0 | 英文、預設聲音、Q8 | 2 |
| Matcha 中文 | 138.9 | 中文女聲、繁轉簡、22.05 kHz | 1 |
| ZipVoice-Distill | 195.7 | 中英文、官方 news-female 聲音、INT8 | 1 |
| Qwen3-TTS 0.6B | 1021.7 | CustomVoice、九個聲音、十種語言、INT4 | 2 |
| OmniVoice | 946.9 | 多語言、聲音描述、INT4 / FP32 codec | 2 |

下載量包含此整合使用的權重、tokenizer、聲音與必要字典，精確值以 `public/catalog.json` 為準。CPU 執行程式共用，不重複計入每個模型。

這裡限制的是 **WASM 推論執行緒數量**。網頁 JavaScript、音訊播放、下載與瀏覽器本身仍由作業系統排程，網站無法保證整個瀏覽器程序只占用兩個實體核心。Matcha / ZipVoice 的官方 WASM 為單推論執行緒。大型模型需要較多 RAM，兩執行緒生成可能很慢；下載量也不等於載入後的記憶體用量。OmniVoice、Qwen 建議在有足夠 RAM 的桌面瀏覽器使用，先以短句測試。

## 下載、保存與離線

- 建議使用更新版桌面 Chrome / Edge；需要 WebAssembly SIMD、Service Worker、Cache Storage 與 SharedArrayBuffer。純 HTTPS 的 GitHub Pages 可用，不需自訂 HTTP header。
- 可選擇模型後按「下載模型」，或直接載入 / 生成；不會自動下載其餘 14 個模型。刪除預設 2M 後，不會在每次重新整理時強制重新下載。
- 下載內容保存於**目前網站、目前瀏覽器使用者設定檔的 Cache Storage**，不是 Downloads 資料夾。Windows 與 Mac、不同瀏覽器各自下載及執行，不共用 Mac 的算力。
- 「申請保留離線資料」向瀏覽器申請持久儲存，是否核准由瀏覽器決定。隱私模式、清除網站資料、空間不足或瀏覽器回收都可能刪除模型；不保證永久保存。
- 大型遠端檔以 8 MiB 分段下載，已完成的分段會保存；失敗或停止後可再按下載繼續。組合時逐段計算完整 SHA-256，失敗就刪除損壞分段。組合期間需要額外磁碟空間，介面會先檢查配額。
- 完成下載會保存模型及對應 CPU 程式。**先在線開啟一次並完成下載**，之後同一瀏覽器可斷網重新載入、生成 WAV。網站更新後可能需要在線補齊新版程式；模型版本沒變就沿用已有權重。
- 網站不傳送輸入文字、聲音描述或生成音訊。首次下載仍會向 GitHub / 公開 Hugging Face 來源發出檔案請求，這些服務會收到一般連線資訊。沒有分析追蹤、API key 或登入需求。
- 模型網址鎖定特定 revision；上游中斷、限流、CORS 變更或移除檔案仍可能使首次下載失敗。已完成的離線模型不需再連線。Matcha / ZipVoice 的部分資產隨網站以分片提供。

模型的使用授權與免費架站是兩件事。請保留附帶的模型卡、LICENSE 與 [THIRD_PARTY.md](THIRD_PARTY.md)。尤其 Matcha 的 DataBaker 資料與 Supertonic 等模型有各自條款；不能將所有模型概括為可任意商用。

## 本機開發與驗證

需要 Node.js 24、pnpm 11.25：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm verify
PAGES_BASE=/voice-lab/ pnpm build
python3 scripts/preview.py --port 5195 --base /voice-lab/
```

開啟 `http://127.0.0.1:5195/voice-lab/`。預覽伺服器只提供靜態檔案，刻意不加入 COOP / COEP，以測試 GitHub Pages 的情境。`pnpm dev` 供修改使用；正式下載與離線流程請使用上述 build 預覽。

- `src/`：介面、下載管理與 CPU 推論程式。
- `public/catalog.json`：15 個模型的固定來源、大小與 SHA-256。
- `public/sw.js`：專案範圍的離線快取與 COOP / COEP 回應處理，參考 MIT 的 [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)。
- `public/support/`、`public/packs/`：隨網站提供的必要小型資產 / 分片，不必自行上傳大型權重到 HF。
- `vendor/`、`public/licenses/`：來源及授權資訊。
- `scripts/package-assets.py`：維護者用的一次性資產打包工具，會讀取相鄰原專案的既有模型；**部署與一般建置不會執行、不需要原專案**。固定上游 metadata 在 `metadata/`。
- `scripts/browser-pages-check.mjs` / `browser-model-check.mjs`：Playwright 瀏覽器驗證，需要另裝 Playwright Chromium；可用 `PLAYWRIGHT_MODULE`、`PLAYWRIGHT_BROWSERS_PATH` 指定測試工具路徑，不是網站執行依賴。

第一次部署不需要 Python、Docker、Mac、GPU 或伺服器。不要把測試用的 `preview.py --fixtures` 模型鏡像當成部署方式。

完整驗證範圍與結果見 [VALIDATION.md](VALIDATION.md)，包含實際公開來源下載、離線測試，以及 SHA-256 一致的靜態鏡像全模型測試。
