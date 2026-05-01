import aiosqlite
from ktv.config import BASE_DIR

DB_PATH = BASE_DIR / "ktv.db"

DDL = """
CREATE TABLE IF NOT EXISTS videos (
    video_id    TEXT PRIMARY KEY,
    title       TEXT,
    artist      TEXT,
    duration    INTEGER,
    thumbnail   TEXT,
    processed_at INTEGER
);

CREATE TABLE IF NOT EXISTS offsets (
    video_id    TEXT NOT NULL,
    lrclib_id   TEXT NOT NULL,
    offset      REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (video_id, lrclib_id)
);

CREATE TABLE IF NOT EXISTS selections (
    video_id     TEXT PRIMARY KEY,
    lrclib_id    TEXT NOT NULL,
    track_name   TEXT,
    artist_name  TEXT,
    synced_lyrics TEXT
);
"""


async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(DDL)
        await db.commit()


# ── Videos ───────────────────────────────────────────

async def upsert_video(meta: dict, processed_at: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO videos "
            "(video_id, title, artist, duration, thumbnail, processed_at) "
            "VALUES (?,?,?,?,?,?)",
            (meta["video_id"], meta.get("title"), meta.get("artist"),
             meta.get("duration"), meta.get("thumbnail"), processed_at),
        )
        await db.commit()


async def get_all_videos() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM videos ORDER BY processed_at DESC"
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


# ── Offsets ───────────────────────────────────────────

async def get_offset(video_id: str, lrclib_id: str) -> float:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT offset FROM offsets WHERE video_id=? AND lrclib_id=?",
            (video_id, lrclib_id),
        ) as cur:
            row = await cur.fetchone()
    return row[0] if row else 0.0


async def set_offset(video_id: str, lrclib_id: str, offset: float):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO offsets (video_id, lrclib_id, offset) VALUES (?,?,?)",
            (video_id, lrclib_id, offset),
        )
        await db.commit()


# ── Selections ────────────────────────────────────────

async def get_selection(video_id: str) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM selections WHERE video_id=?", (video_id,)
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def set_selection(video_id: str, lrclib_id: str,
                        track_name: str, artist_name: str, synced_lyrics: str | None):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO selections "
            "(video_id, lrclib_id, track_name, artist_name, synced_lyrics) "
            "VALUES (?,?,?,?,?)",
            (video_id, str(lrclib_id), track_name, artist_name, synced_lyrics),
        )
        await db.commit()
