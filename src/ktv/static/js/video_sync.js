// Audio is the master clock. Correct only the muted video so buffering and
// dropped frames cannot interrupt either of the overlapping audio tracks.
export class VideoAudioSync {
  constructor(video, audio) {
    this.video = video;
    this.audio = audio;
  }

  get currentTime() {
    return this.audio.playing ? this.audio.currentTime : this.video.currentTime;
  }

  // Keyboard, buttons and lyrics move both clocks at once, so the lyrics and
  // repeated jumps see the new position before the video finishes seeking.
  seek(time) {
    this.audio.seek(time);
    this.video.playbackRate = 1;
    this.video.currentTime = time;
  }

  followAudio({ force = false } = {}) {
    const video = this.video;
    if (!this.audio.playing || video.seeking) return;
    if (!force && (video.paused || video.readyState < 2)) return;
    const time = this.audio.currentTime;
    if (!Number.isFinite(time) || (Number.isFinite(video.duration) && time >= video.duration)) return;
    const drift = video.currentTime - time;
    if (Math.abs(drift) > 0.5 || (force && Math.abs(drift) > 0.05)) {
      video.playbackRate = 1;
      video.currentTime = time;
    } else {
      // Small clock differences need only a gentle, inaudible video speed change.
      video.playbackRate = Math.abs(drift) <= 0.05 ? 1 : 1 - Math.max(-0.03, Math.min(0.03, drift * 0.1));
    }
  }

  // Browsers fire timeupdate before seeked, with seeking already false, so a
  // native-controls seek must move the audio on `seeking` or followAudio would
  // pull the video back. Corrections and seek() already match the audio clock.
  seeking() {
    const time = this.video.currentTime;
    if (Math.abs(time - this.audio.currentTime) > 0.25) this.audio.seek(time);
  }

  reset() {
    this.video.playbackRate = 1;
  }
}
