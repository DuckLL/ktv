// Audio is the master clock. Correct only the muted video so buffering and
// dropped frames cannot interrupt either of the overlapping audio tracks.
export class VideoAudioSync {
  constructor(video, audio) {
    this.video = video;
    this.audio = audio;
    this.correctionTarget = null;
  }

  followAudio({ force = false } = {}) {
    const video = this.video;
    if (!this.audio.playing || video.seeking || this.correctionTarget !== null) return;
    if (!force && (video.paused || video.readyState < 2)) return;
    const time = this.audio.currentTime;
    if (!Number.isFinite(time) || (Number.isFinite(video.duration) && time >= video.duration)) return;
    const drift = video.currentTime - time;
    if (Math.abs(drift) > 0.5 || (force && Math.abs(drift) > 0.05)) {
      this.correctionTarget = time;
      video.playbackRate = 1;
      video.currentTime = time;
    } else {
      // Small clock differences need only a gentle, inaudible video speed change.
      video.playbackRate = Math.abs(drift) <= 0.05 ? 1 : 1 - Math.max(-0.03, Math.min(0.03, drift * 0.1));
    }
  }

  seeked() {
    const target = this.correctionTarget;
    this.correctionTarget = null;
    this.video.playbackRate = 1;
    if (target !== null && Math.abs(this.video.currentTime - target) <= 0.25) return;
    // A seek from the native controls, keyboard or lyrics is intentional.
    this.audio.seek(this.video.currentTime);
  }

  reset() {
    this.correctionTarget = null;
    this.video.playbackRate = 1;
  }
}
