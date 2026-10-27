# 瀏覽器回歸測試

需要已完成 `uv sync`、FFmpeg、Node.js 及 Playwright Chromium。

```bash
npm install --prefix /tmp/ktv-browser-tools playwright
node /tmp/ktv-browser-tools/node_modules/playwright/cli.js install chromium
NODE_PATH=/tmp/ktv-browser-tools/node_modules node tests/browser/practice.cjs
```

測試自動建立暫存歌曲與資料庫，啟動本機測試服務，完成後清除。歌曲目錄與資料庫皆在獨立的系統暫存目錄中，歌曲清理在匯入模組前關閉，不操作開發環境的歌曲資料。麥克風以已知的 A4 WAV 經 Chromium 收音流程輸入，會檢查音高辨識及接近目標的回饋。

外部 YouTube／LRCLIB 回應以固定資料取代；音訊播放、音高分析、歌詞選擇與時間差保存使用實際後端。包含按鈕及鍵盤前後調整 0.5 秒、重置、重新載入後還原，以及延遲回應時切換歌詞版本、在等待新版本時調整舊版本時間差、快速分別調整兩個版本時間差的情境。瀏覽器例外會使測試失敗，另檢查 390／320 px 排版與設定還原。

背景自動對齊另用固定的人聲起音資料，驗證 0.4 秒校正會自動保存、仍能以 0.5 秒微調，且重新載入後保留手動調整結果。另驗證「自動校正」預設開啟、關閉會取消等待中的校正、重新載入會記住開關狀態，以及開啟後立即校正目前歌詞。介面的前後 0.5 秒、重置與自動校正開關在 1366／800／768／390／320 px 均須維持同列。

截圖預設存到 `/tmp/ktv-browser-review`；可用 `KTV_BROWSER_ARTIFACTS` 指定位置。自訂 Python 執行檔可設 `KTV_TEST_PYTHON`，連接埠可設 `KTV_TEST_PORT`。Linux 測試機需要 Chromium 使用的系統函式庫及中文字型。
