// Start both decoded tracks on one audio clock. Independent HTMLAudioElements
// can drift enough to produce comb filtering when their music overlaps.
export class SynchronizedAudioPlayer {
  constructor(urls, context = new AudioContext({ latencyHint: 'playback' }), fetchAudio = globalThis.fetch.bind(globalThis)) {
    this.context = context;
    this.urls = urls;
    this.fetchAudio = fetchAudio;
    this.gains = urls.map(() => {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      return gain;
    });
    this.sources = urls.map(() => null);
    this.buffers = urls.map(() => null);
    this.loads = [];
    this.decoding = Promise.resolve();
    this.playing = false;
    this.offset = 0;
    this.startedAt = 0;
    this.revision = 0;
  }

  // Playback needs only the first track; the others can load behind it.
  load() {
    return this.loadTrack(0);
  }

  loadTrack(index) {
    this.loads[index] ??= (async () => {
      const response = await this.fetchAudio(this.urls[index]);
      if (!response.ok) throw new Error(`Audio download failed (${response.status})`);
      const data = await response.arrayBuffer();
      // Avoid two large decoder jobs competing for memory on mobile devices.
      const decoded = this.decoding.then(() => this.context.decodeAudioData(data));
      this.decoding = decoded.catch(() => {});
      this.buffers[index] = await decoded;
      // A track that finishes loading mid-song joins the running clock.
      if (this.playing) this.startTrack(index, this.context.currentTime + 0.02);
    })();
    return this.loads[index];
  }

  setVolumes(volumes) {
    this.gains.forEach((gain, index) => {
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setTargetAtTime(volumes[index], this.context.currentTime, 0.015);
    });
  }

  get currentTime() {
    return this.offset + (this.playing ? Math.max(0, this.context.currentTime - this.startedAt) : 0);
  }

  async play(time) {
    const revision = ++this.revision;
    // Resume during the user gesture, before waiting for downloads.
    const resumed = this.context.resume();
    await Promise.all([resumed, this.load()]);
    if (revision !== this.revision) return;
    this.start(typeof time === 'function' ? time() : time);
  }

  start(time) {
    this.stopSources();
    this.offset = Math.max(0, time);
    this.startedAt = this.context.currentTime + 0.02;
    this.playing = true;
    this.buffers.forEach((buffer, index) => {
      if (buffer) this.startTrack(index, this.startedAt);
    });
  }

  // Play from the shared timeline's position at context time `when`.
  startTrack(index, when) {
    const buffer = this.buffers[index];
    const position = this.offset + Math.max(0, when - this.startedAt);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gains[index]);
    if (position < buffer.duration) source.start(when, position);
    this.sources[index] = source;
  }

  stopSources() {
    this.sources.forEach(source => {
      if (!source) return;
      try { source.stop(); } catch (_) {}
      source.disconnect();
    });
    this.sources = this.urls.map(() => null);
  }

  pause() {
    this.revision++;
    this.offset = this.currentTime;
    this.playing = false;
    this.stopSources();
  }

  seek(time) {
    this.offset = Math.max(0, time);
    if (this.playing) this.start(this.offset);
  }

}
