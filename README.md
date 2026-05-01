# 🎤 KTV

YouTube 卡拉 OK 播放器。貼上 YouTube 網址，自動下載影片、分離人聲、同步歌詞。

## 功能

- **人聲分離**：使用 [demucs](https://github.com/facebookresearch/demucs) (htdemucs) 分離伴唱與人聲
- **伴唱 / 人聲混音**：播放時可加入少量人聲導唱，不需重新載入
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
> Docker Compose 會將 `./cache` 掛到容器的 `/app/cache`，並將 `./data` 掛到 `/app/data`。
> 若你有舊版根目錄的 `ktv.db`，請先移到 `data/ktv.db` 再啟動。

## 使用說明

1. 在首頁貼上 YouTube 網址，按「開始處理」
2. 等待處理完成（CPU 模式下，4 分鐘的歌約需 12–20 分鐘）
3. 進入播放頁後，在右側搜尋欄輸入關鍵字搜尋歌詞
4. 選擇正確的歌詞版本，播放時會自動同步
5. 若歌詞有時間差，用 offset bar 或 `[` `]` 鍵調整，設定會自動儲存

## Cache 結構

每首歌處理完後存放於 `cache/{video_id}/`：

```
cache/{video_id}/
  video_only.webm  # 純影片（無音軌）
  no_vocals.webm   # 伴唱音訊
  vocals.webm      # 純人聲音訊
  meta.json        # 標題、歌手等元資料
```

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
