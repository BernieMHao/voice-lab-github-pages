# 驗證紀錄（2026-10-27）

本機 Chromium 停用 GPU / WebGPU，以無 COOP / COEP 標頭的靜態 HTTP server 模擬 GitHub Pages 的 `/voice-lab/` 子路徑。此部分為部署前的本機預覽測試；正式部署紀錄如下。

- 15 個模型皆在瀏覽器 WebAssembly CPU 完成推論，輸出正確取樣率的非靜音 PCM16 WAV。
- Pocket 2M 實際從固定 revision 的公開 Hugging Face 來源下載；驗證首次預設下載、SHA-256、僅下載選定模型、兩推論執行緒、斷網重新整理及生成、刪除再下載。
- 全模型矩陣使用本機**唯讀靜態鏡像**提供權重，以避免重複經網路下載數 GB；鏡像每個檔案先核對與正式公開清單相同的完整 SHA-256。推論仍全部在瀏覽器完成。這項測試不代表已逐一完成所有上游 URL 的端到端網路下載；上游可用性仍可能改變。
- 下載續傳測試：保存至少兩個 8 MiB 分段後停止、重新整理、繼續；請求紀錄確認未重新下載第一段，最後完整 SHA-256 通過。
- 桌面與 390px 手機寬度檢查通過，手機檢查是版面測試，未宣稱所有手機都能載入大型模型。
- `pnpm test` 四項測試通過，`pnpm verify` 核對全部本地資產 / 分片的 SHA-256、15 模型清單及 GitHub 檔案限制，正式子路徑建置通過。
- 原專案 `src/` 與 Python scripts 的預先 SHA-256 快照比對無異動；新成品全部放在獨立資料夾。

原始 JSON 紀錄在 `validation/`。生成耗時包含當時負載，不作為效能保證；非靜音檢查不等同逐句音質與發音評測。OmniVoice / Qwen 的大型模型需要較多 RAM，短句也可能耗時數分鐘。

| 模型 ID | WAV 取樣率 Hz | RMS | CPU 生成 |
| --- | ---: | ---: | --- |
| 100m | 24000 | 0.1166 | 通過 |
| 18m | 24000 | 0.1234 | 通過 |
| 7m | 24000 | 0.1171 | 通過 |
| 2m | 24000 | 0.1126 | 通過 |
| kokoro | 24000 | 0.0663 | 通過 |
| kitten-nano | 24000 | 0.1092 | 通過 |
| kitten-micro | 24000 | 0.1214 | 通過 |
| kitten-mini | 24000 | 0.1008 | 通過 |
| piper | 22050 | 0.1033 | 通過 |
| supertonic | 44100 | 0.0468 | 通過 |
| phonon | 24000 | 0.0851 | 通過 |
| matcha | 22050 | 0.0937 | 通過 |
| zipvoice | 24000 | 0.1679 | 通過 |
| qwen | 24000 | 0.1015 | 通過 |
| omnivoice | 24000 | 0.1543 | 通過 |

## GitHub Pages 正式部署

2026-10-27 已部署至 [https://berniemhao.github.io/voice-lab-github-pages/](https://berniemhao.github.io/voice-lab-github-pages/)。公開 repository 為 [BernieMHao/voice-lab-github-pages](https://github.com/BernieMHao/voice-lab-github-pages)。[GitHub Actions build / deploy 均成功](https://github.com/BernieMHao/voice-lab-github-pages/actions/runs/40504563209)，發布 commit 為 `f0c52178dfddf59c9df79b0479d49955ec6283be`。

正式網址已以 Brave 首次開啟驗證：自動下載 PocketTTS-2M 完成，以 CPU / 2 threads 生成 `Hello! Welcome to Voice Lab.`，畫面顯示生成時間 0.50 秒、音訊長度 2.40 秒，並提供音訊播放器與 WAV 下載連結。
