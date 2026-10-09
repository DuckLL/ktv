// Start both decoded tracks on one audio clock. Independent HTMLAudioElements
// can drift enough to produce comb filtering when their music overlaps.
export class SynchronizedAudioPlayer {
  constructor(urls, context = new AudioContext({ latencyHint: 'playback' }), fetchAudio = globalThis.fetch.bind(globalThis)) {
    this.context = context;
    this.urls = urls;
    this.baseUrls = [...urls];
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
    this.onended = null;
    this.keySemitones = 0;
    this.keyRevision = 0;
    this.trackGeneration = 0;
    this.keyAbort = null;
    this.onkeychange = null;
  }

  // Playback needs only the first track; the others can load behind it.
  load() {
    return this.loadTrack(0);
  }

  loadTrack(index) {
    const generation = this.trackGeneration;
    this.loads[index] ??= (async () => {
      const buffer = await this.decodeTrack(this.urls[index]);
      if (generation !== this.trackGeneration) return;
      this.buffers[index] = buffer;
      // A track that finishes loading mid-song joins the running clock.
      if (this.playing) this.startTrack(index, this.context.currentTime + 0.02);
    })();
    return this.loads[index];
  }

  async decodeTrack(url, signal) {
    const response = await this.fetchAudio(url, { signal });
    if (!response.ok) throw new Error(`Audio download failed (${response.status})`);
    const data = await response.arrayBuffer();
    // Share the decoder queue with key changes to bound mobile memory spikes.
    const decoded = this.decoding.then(() => this.context.decodeAudioData(data));
    this.decoding = decoded.catch(() => {});
    return decoded;
  }

  async setKey(semitones) {
    if (!Number.isInteger(semitones) || semitones < -6 || semitones > 6) throw new RangeError('Key must be an integer from -6 to 6');
    const revision = ++this.keyRevision;
    this.keyAbort?.abort();
    if (semitones === this.keySemitones) return;
    const controller = new AbortController();
    this.keyAbort = controller;
    const urls = this.baseUrls.map(url => semitones === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}key=${semitones}`);
    const buffers = [];
    try {
      for (const url of urls) {
        buffers.push(await this.decodeTrack(url, controller.signal));
        if (revision !== this.keyRevision) return;
      }
      // Swap both tracks at the live position, after preparation. A pause, seek
      // or natural ending while loading must remain the user's latest action.
      const position = this.currentTime;
      this.trackGeneration++;
      this.urls = urls;
      this.buffers = buffers;
      this.loads = buffers.map(() => Promise.resolve());
      this.keySemitones = semitones;
      if (this.playing) this.start(position);
      else this.offset = Math.min(position, this.duration);
      this.onkeychange?.(semitones);
    } finally {
      if (this.keyAbort === controller) this.keyAbort = null;
    }
  }

  setVolumes(volumes) {
    this.gains.forEach((gain, index) => {
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setTargetAtTime(volumes[index], this.context.currentTime, 0.015);
    });
  }

  get currentTime() {
    return Math.min(this.duration, this.offset + (this.playing ? Math.max(0, this.context.currentTime - this.startedAt) : 0));
  }

  get duration() {
    return this.buffers[0]?.duration ?? Infinity;
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
    this.offset = Math.max(0, Math.min(time, this.duration));
    this.startedAt = this.context.currentTime + 0.02;
    this.playing = true;
    if (this.offset >= this.duration) {
      this.finish();
      return;
    }
    this.buffers.forEach((buffer, index) => {
      if (buffer) this.startTrack(index, this.startedAt);
    });
  }

  // Play from the shared timeline's position at context time `when`.
  startTrack(index, when) {
    const buffer = this.buffers[index];
    const position = this.offset + Math.max(0, when - this.startedAt);
    if (position >= buffer.duration) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gains[index]);
    this.sources[index] = source;
    if (index === 0) {
      source.onended = () => {
        // Replaced/stopped sources must never end a newer play or seek.
        if (this.playing && this.sources[index] === source) this.finish();
      };
    }
    source.start(when, position);
  }

  finish() {
    this.revision++;
    this.offset = this.duration;
    this.playing = false;
    this.stopSources();
    this.onended?.();
  }

  stopSources() {
    this.sources.forEach(source => {
      if (!source) return;
      source.onended = null;
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
    this.offset = Math.max(0, Math.min(time, this.duration));
    if (this.playing) this.start(this.offset);
  }

}
