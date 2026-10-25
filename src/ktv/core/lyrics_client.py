import asyncio
import re
from difflib import SequenceMatcher

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


def lyric_metadata(title: str, artist: str) -> tuple[str, str]:
    """Remove video packaging while keeping the actual song/version name."""
    enclosed = re.search(r"[【《「](.+?)[】》」]", title)
    if enclosed:
        title = enclosed[1]
    title = re.sub(r"[\[(（](?:official|music video|lyrics?|mv|hd|4k|官方|歌詞)[^\])）]*[\])）]", "", title, flags=re.I)
    title = re.sub(r"\s*[-–|]?\s*(?:official\s*)?(?:music video|lyric video|audio|mv|hd|4k)\s*$", "", title, flags=re.I)
    artist = re.sub(r"\s*[-–]\s*Topic$", "", artist, flags=re.I)
    if " - " in title:
        possible_artist, title = title.split(" - ", 1)
        artist = possible_artist
    return title.strip(" -–|"), artist.strip()


def _normal(text: str) -> str:
    return "".join(c for c in text.casefold() if c.isalnum())


def _similarity(a: str, b: str) -> float:
    a, b = _normal(a), _normal(b)
    if not a or not b:
        return 0
    if a == b:
        return 1
    if min(len(a), len(b)) >= 2 and (a in b or b in a):
        return 0.94
    return SequenceMatcher(None, a, b).ratio()


def _versions(title: str) -> set[str]:
    return {key for key, pattern in {
        "live": r"\blive\b|現場|现场|演唱會|演唱会",
        "cover": r"\bcover\b|翻唱", "remix": r"\bremix\b",
        "acoustic": r"\bacoustic\b|不插電|不插电",
        "instrumental": r"\binstrumental\b|\bkaraoke\b|伴奏|純音樂|纯音乐",
    }.items() if re.search(pattern, title, re.I)}


def rank_candidates(items: list[dict], title: str, artist: str, duration: float) -> list[dict]:
    ranked = []
    for item in items:
        track = _similarity(title, item.get("trackName") or "")
        singer = _similarity(artist, item.get("artistName") or "")
        length = item.get("duration")
        distance = abs(length - duration) if isinstance(length, (int, float)) and duration > 0 else None
        score = 0.65 * track + 0.3 * singer + (0.05 * max(0, 1 - distance / 15) if distance is not None else 0)
        # A synchronized cover of a different length is still offered, but never auto-selected.
        same_version = _versions(title) == _versions(item.get("trackName") or "")
        automatic = bool(item.get("syncedLyrics")) and track >= 0.9 and singer >= 0.65 and distance is not None and distance <= 8 and same_version
        ranked.append({**item, "matchScore": round(score, 3), "autoSelect": automatic})
    return sorted(ranked, key=lambda item: (bool(item.get("syncedLyrics")), item["matchScore"]), reverse=True)


async def find_lyrics(title: str, artist: str, duration: float) -> dict:
    title, artist = lyric_metadata(title, artist)
    queries = [{"q": " ".join((artist, title)).strip()}, {"track_name": title, "artist_name": artist}]
    cjk = "".join(re.findall(r"[\u3400-\u9fff]+", title))
    if cjk:
        queries.append({"q": cjk})
    else:
        queries.append({"q": title})
    async with httpx.AsyncClient(timeout=12, headers={"User-Agent": "KTV/0.1 (https://github.com/DuckLL/ktv)"}) as client:
        async def request(params):
            response = await client.get(f"{LRCLIB_BASE}/search", params=params)
            response.raise_for_status()
            return response.json()
        responses = await asyncio.gather(*(request(params) for params in queries if any(params.values())), return_exceptions=True)
    found = {}
    for response in responses:
        if isinstance(response, list):
            for item in response:
                if isinstance(item, dict) and item.get("id") is not None:
                    found[item["id"]] = item
    if responses and all(isinstance(response, Exception) for response in responses):
        raise RuntimeError("歌詞服務暫時無法使用，請稍後重試")
    ranked = rank_candidates(list(found.values()), title, artist, duration)
    chosen = ranked[0] if ranked and ranked[0]["autoSelect"] and (len(ranked) == 1 or ranked[0]["matchScore"] - ranked[1]["matchScore"] >= 0.04 or _normal(ranked[0].get("artistName", "")) == _normal(ranked[1].get("artistName", ""))) else None
    return {"query": " ".join((artist, title)).strip(), "results": ranked, "selected": chosen}
