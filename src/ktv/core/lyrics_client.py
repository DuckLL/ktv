import httpx

from ktv.config import LRCLIB_BASE


async def search_lyrics(q: str = "", artist: str = "", track: str = "") -> list[dict]:
    params: dict = {}
    if artist and track:
        params = {"artist_name": artist, "track_name": track}
    elif q:
        params = {"q": q}
    else:
        return []

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{LRCLIB_BASE}/search", params=params)
        resp.raise_for_status()
        return resp.json()


async def get_lyrics(lrclib_id: int) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{LRCLIB_BASE}/get/{lrclib_id}")
        resp.raise_for_status()
        return resp.json()
