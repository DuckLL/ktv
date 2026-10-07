# 🎤 KTV

YouTube 卡拉 OK 播放器。貼上 YouTube 網址，自動下載影片、分離人聲、同步歌詞。

## 功能

- **人聲分離**：使用 [demucs](https://github.com/facebookresearch/demucs) (htdemucs) 分離伴唱與人聲
- **伴唱 / 原唱混音**：保留下載音源，播放時平順加入原唱導唱；兩軌共用音訊時鐘，伴奏總增益維持固定
- **同步歌詞**：自動從 [lrclib.net](https://lrclib.net) 搜尋，支援 LRC 格式逐字同步
- **歌詞時間差調整**：可微調歌詞與音樂的偏移量，設定自動儲存
- **記憶選擇**：記住上次選的歌詞版本，下次進入直接顯示
- **影片庫**：首頁顯示已處理的影片，支援標題 / 歌手搜尋
- **鍵盤控制**：`←` `→` 快退進 5 秒，`↑` `↓` 音量，`[` `]` 歌詞微調

## 快速開始

### 本機開發

需要：Python 3.12+、[uv](https://docs.astral.sh/uv/)、ffmpeg

```bash
git clone https://github.com/DuckLL/ktv.git
cd ktv
uv sync
uv run uvicorn ktv.main:app --reload
```

開啟 http://localhost:8000

### Docker

```bash
docker compose up --build
```

> 第一次 build 會下載 demucs htdemucs 模型（約 80 MB）。  
> 模型透過 Docker volume 快取，後續 rebuild 不需重新下載。
> Docker Compose 會使用 named volumes 保存 `/app/cache` 與 `/app/data`，
> 避免 host bind mount 的空目錄權限造成 SQLite 無法建立 `ktv.db`。
> 若你有舊版根目錄的 `ktv.db`，可匯入到 `ktv-data` volume 的 `/app/data/ktv.db`。

## YouTube 下載與 403

YouTube 的影片網址要先跑一段 YouTube 的 JavaScript 才解得開，yt-dlp 把這件事交給外部 JS runtime：

- Docker image 內建 [deno](https://deno.com)（`Dockerfile` 從 `denoland/deno` 複製），yt-dlp 以 `yt-dlp[default]` 安裝，含解題元件 `yt-dlp-ejs`。
- 本機開發要自己裝 deno（`curl -fsSL https://deno.land/install.sh | sh`），否則 yt-dlp 會警告 `No supported JavaScript runtime`，多數影片下載時回 **HTTP 403**。

YouTube 經常改版，yt-dlp 也要跟著更新，所以 **yt-dlp 不照 `uv.lock`**：`Dockerfile` 最後一層在每次 build 時把它升到最新版，其他套件仍照 lock。這一層的快取靠 build arg `YTDLP_REFRESH` 打破，改它的值就只重做這一步（模型與其他相依不重抓）：

```bash
docker compose build --build-arg YTDLP_REFRESH=$(date +%G-W%V)   # 例如每週一次
docker compose up -d
```

遇到 403 就照上面重新 build 一次。`uv.lock` 裡的 yt-dlp 只代表本機開發與最低版本，偶爾用 `uv lock --upgrade-package yt-dlp` 跟上即可。

## 使用說明

1. 在首頁貼上 YouTube 網址，按「開始處理」
2. 等待處理完成（CPU 模式下，4 分鐘的歌約需 12–20 分鐘）
3. 進入播放頁後，在右側搜尋欄輸入關鍵字搜尋歌詞
4. 選擇正確的歌詞版本，播放時會自動同步
5. 若歌詞有時間差，用 offset bar 或 `[` `]` 鍵調整，設定會自動儲存

## 快取自動清理

處理過的歌（影片、分離後的伴唱與人聲）很佔空間，而且隨時能重新處理，所以**超過 7 天沒播放的歌會被自動刪除**：

- 播放器讀取影片或音軌、或重新送出已處理過的網址，都算一次存取（同一首歌一小時內只記一次）。從沒播放過的歌從處理完成的時間起算。
- 啟動時清一次，之後每 6 小時一次。刪除的是 `cache/{video_id}/` 與影片庫的那一筆；**歌詞版本選擇與時間差會保留**，重新處理同一首歌就會套用回來。
- 正在處理中的歌不會被刪；下載失敗留下的半成品依資料夾時間判斷。
- 天數用環境變數 `KTV_CACHE_TTL_DAYS` 調整（預設 `7`，`0` 關閉）。

## Cache 結構

每首歌處理完後存放於 `cache/{video_id}/`：

```
cache/{video_id}/
  video_only.webm  # 純影片（無音軌）
  original.webm   # 未重新編碼的原唱（依來源也可能是 original.m4a 等）
  no_vocals.webm  # 伴唱音訊，Opus 256 kbps
  separation.json # 分離工具與版本，用於判斷快取是否需要重建
  meta.json        # 標題、歌手等元資料
```

下載使用不限容器的 `bestaudio`，依品質、碼率及取樣率選擇可取得的最佳音軌；實際格式、codec、碼率、取樣率與 yt-dlp 版本會記錄於 `meta.json` 的 `source_audio`。原唱直接播放下載內容，不經 Demucs 或再次編碼。

導唱比例沿用平方曲線：原唱增益為 `音量 × 比例²`，伴唱增益為 `音量 × (1 − 比例²)`。因此原唱包含的伴奏不會被重複加到全音量；100% 直接播放原唱。分離輸出保持來源增益，只對超出範圍的峰值做限幅。

播放器會先解碼兩個音軌；長歌曲會使用較多瀏覽器記憶體。舊版快取已刪除原唱，需在首頁重新送出同一網址；新流程會自動重建不符合版本的伴唱快取。

影片庫與歌詞選擇記錄存於 `data/ktv.db`（SQLite）。

## 技術架構

| 層 | 技術 |
|----|------|
| 後端 | Python / FastAPI / uv |
| 下載 | yt-dlp |
| 人聲分離 | demucs (htdemucs, CPU) |
| 音訊合併 | ffmpeg |
| 歌詞 | lrclib.net API |
| 資料庫 | SQLite (aiosqlite) |
| 前端 | 原生 HTML / CSS / JS（無框架） |
| 進度推送 | SSE (Server-Sent Events) |
| 容器 | Docker + docker compose |
