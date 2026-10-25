# 瀏覽器回歸測試

需要已完成 `uv sync`、FFmpeg、Node.js 及 Playwright Chromium。

```bash
npm install --prefix /tmp/ktv-browser-tools playwright
node /tmp/ktv-browser-tools/node_modules/playwright/cli.js install chromium
NODE_PATH=/tmp/ktv-browser-tools/node_modules node tests/browser/practice.cjs
```

測試自動建立暫存歌曲與資料庫，啟動本機測試服務，完成後清除。歌曲目錄與資料庫皆在獨立的系統暫存目錄中，歌曲清理在匯入模組前關閉，不操作開發環境的歌曲資料。麥克風以已知的 A4 WAV 經 Chromium 收音流程輸入，會檢查音高辨識及接近目標的回饋。

外部 YouTube／LRCLIB 回應以固定資料取代；音訊播放、音高分析、歌詞選擇與校正保存使用實際後端。包含延遲回應時切換歌詞版本、在等待新版本時編輯舊版本、快速分別調整兩個版本時間差的情境。瀏覽器例外會使測試失敗，另檢查 390／320 px 排版與設定還原。

截圖預設存到 `/tmp/ktv-browser-review`；可用 `KTV_BROWSER_ARTIFACTS` 指定位置。自訂 Python 執行檔可設 `KTV_TEST_PYTHON`，連接埠可設 `KTV_TEST_PORT`。Linux 測試機需要 Chromium 使用的系統函式庫及中文字型。
