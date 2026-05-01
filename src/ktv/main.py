from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from ktv.core.db import init_db
from ktv.api.process import router as process_router
from ktv.api.lyrics import router as lyrics_router
from ktv.api.video import router as video_router
from ktv.api.offset import router as offset_router
from ktv.api.library import router as library_router
from ktv.api.selection import router as selection_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="KTV", lifespan=lifespan)

app.include_router(process_router, prefix="/api")
app.include_router(lyrics_router, prefix="/api")
app.include_router(video_router, prefix="/api")
app.include_router(offset_router, prefix="/api")
app.include_router(library_router, prefix="/api")
app.include_router(selection_router, prefix="/api")

STATIC_DIR = Path(__file__).parent / "static"

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/player")
async def player():
    return FileResponse(STATIC_DIR / "player.html")
