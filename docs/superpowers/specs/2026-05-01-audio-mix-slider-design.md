# Audio Mix Slider Design

## Goal

Add a mix slider between the existing "伴唱" and "原唱" buttons on the player page so singers can blend a small amount of original vocal into the accompaniment.

## Current Behavior

The player loads two separate audio files:

- `no_vocals.webm` through `/api/audio/{video_id}/instrumental`
- `audio.webm` through `/api/audio/{video_id}/original`

Only one audio element is active at a time. The "伴唱" and "原唱" buttons switch the active audio element, and the current master volume applies only to that active element.

## Proposed Behavior

Keep both existing buttons and add one slider between them:

`伴唱 [slider] 原唱`

The slider represents the original-vocal mix amount:

- `0%`: pure accompaniment
- `100%`: pure original
- Intermediate values: both audio elements play together with proportional volume

The default value is `0%`, preserving the current startup behavior.

## Controls

- Clicking "伴唱" sets the slider to `0%`.
- Clicking "原唱" sets the slider to `100%`.
- Dragging the slider updates the blend immediately.
- Button active state follows the slider:
  - "伴唱" active at `0%`
  - "原唱" active at `100%`
  - neither button active for mixed values
- Keyboard volume controls still adjust a single master volume.

## Audio Model

Both audio elements stay synchronized to the muted video element. Effective volumes are:

- Instrumental volume: `masterVolume * (1 - mixAmount)`
- Original volume: `masterVolume * mixAmount`

When the video plays, both audio elements should play. When the video pauses, both should pause. Seeking and background-tab recovery should resync both audio elements to the video timeline.

## Error Handling

If the original audio cannot play or load, the accompaniment path should continue to work. The slider can remain visible because both audio endpoints are expected for processed videos, but playback logic should avoid throwing uncaught errors from failed `play()` calls.

## Files To Change

- `src/ktv/static/player.html`: add the mix slider between the existing audio buttons.
- `src/ktv/static/css/style.css`: style the compact slider inside the control bar.
- `src/ktv/static/js/player.js`: replace single-active-audio switching with dual-audio sync and proportional volume.

## Testing

The project currently has no frontend test runner. Implementation should keep the mix calculation small and explicit, then verify manually in the browser:

- default is pure accompaniment
- "伴唱" sets `0%`
- "原唱" sets `100%`
- mixed slider values play both tracks
- play, pause, seek, and keyboard volume still work
