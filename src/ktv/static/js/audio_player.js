// Start both decoded tracks on one audio clock. Independent HTMLAudioElements
// can drift enough to produce comb filtering when their music overlaps.
export class SynchronizedAudioPlayer {
  constructor(urls, context = new AudioContext(), fetchAudio = globalThis.fetch.bind(globalThis)) {
    this.context = context;
    this.urls = urls;
    this.fetchAudio = fetchAudio;
    this.gains = urls.map(() => {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(context.destination);
      return gain;
    });
    this.sources = [];
    this.buffers = null;
    this.loading = null;
    this.playing = false;
    this.offset = 0;
    this.startedAt = 0;
    this.revision = 0;
  }

  load() {
    if (!this.loading) {
      this.loading = Promise.all(this.urls.map(async url => {
        const response = await this.fetchAudio(url);
        if (!response.ok) throw new Error(`Audio download failed (${response.status})`);
        return this.context.decodeAudioData(await response.arrayBuffer());
      })).then(buffers => { this.buffers = buffers; });
    }
    return this.loading;
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
    this.sources = this.buffers.map((buffer, index) => {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gains[index]);
      if (this.offset < buffer.duration) source.start(this.startedAt, this.offset);
      return source;
    });
  }

  stopSources() {
    this.sources.forEach(source => {
      try { source.stop(); } catch (_) {}
      source.disconnect();
    });
    this.sources = [];
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

  sync(time) {
    if (this.playing && Math.abs(this.currentTime - time) > 0.15) this.seek(time);
  }
}
