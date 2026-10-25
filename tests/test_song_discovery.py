import unittest
from unittest.mock import MagicMock, patch

from ktv.api.search import search_songs
from ktv.core.lyrics_client import lyric_metadata, rank_candidates


class DiscoveryTests(unittest.TestCase):
    def test_search_uses_metadata_only_and_filters_long_or_invalid_videos(self):
        ydl = MagicMock()
        ydl.extract_info.return_value = {"entries": [
            {"id": "abcdefghijk", "title": "Practice", "duration": 240, "channel": "Artist"},
            {"id": "longvideo01", "duration": 3600},
            {"id": "livevideo01", "live_status": "is_live"},
            {"id": "invalid"},
        ]}
        with patch('ktv.api.search.yt_dlp.YoutubeDL') as factory:
            factory.return_value.__enter__.return_value = ydl
            songs = search_songs('歌名 歌手')
        ydl.extract_info.assert_called_once_with('ytsearch8:歌名 歌手', download=False)
        self.assertEqual([song['video_id'] for song in songs], ['abcdefghijk'])
        self.assertTrue(factory.call_args[0][0]['skip_download'])

    def test_video_title_packaging_is_removed(self):
        self.assertEqual(lyric_metadata('周杰倫 Jay Chou【七里香 Orange Jasmine】-Official Music Video', '周杰倫 Jay Chou'), ('七里香 Orange Jasmine', '周杰倫 Jay Chou'))
        self.assertEqual(lyric_metadata('Artist - Song (Official Video)', 'Artist - Topic'), ('Song', 'Artist'))

    def test_wrong_artist_or_length_never_auto_selects_even_with_matching_title(self):
        items = [
            {"id": 1, "trackName": "Song", "artistName": "Other", "duration": 240, "syncedLyrics": '[00:01]x'},
            {"id": 2, "trackName": "Song", "artistName": "Artist", "duration": 240, "syncedLyrics": '[00:01]x'},
            {"id": 3, "trackName": "Song", "artistName": "Artist", "duration": 300, "syncedLyrics": '[00:01]x'},
            {"id": 4, "trackName": "Song", "artistName": "Artist", "duration": 240, "plainLyrics": 'x'},
        ]
        ranked = rank_candidates(items, 'Song', 'Artist', 241)
        self.assertEqual(ranked[0]['id'], 2)
        self.assertEqual([item['id'] for item in ranked if item['autoSelect']], [2])

    def test_live_recording_does_not_auto_select_studio_lyrics(self):
        item = {"id": 1, "trackName": "Song", "artistName": "Artist", "duration": 240, "syncedLyrics": '[00:01]x'}
        self.assertFalse(rank_candidates([item], 'Song (Live)', 'Artist', 240)[0]['autoSelect'])
