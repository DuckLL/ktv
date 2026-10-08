import { PitchDetector } from '/static/vendor/pitchy/pitchy.js';
import { captureSongTime, hzToMidi, midiToNote, pitchChartRange, pitchDifferenceCents, pitchFeedback, referenceAt } from '/static/js/pitch_math.js';

const WINDOW_SIZE = 4096;
const PAST_SECONDS = 4;
const FUTURE_SECONDS = 8;

export class PitchFeedback {
  constructor(audio, videoId) {
    this.audio = audio;
    this.videoId = videoId;
    this.panel = document.getElementById('pitchPanel');
    this.button = document.getElementById('pitchMicToggle');
    this.status = document.getElementById('pitchStatus');
    this.result = document.getElementById('pitchResult');
    this.delay = document.getElementById('pitchDelaySlider');
    this.delayValue = document.getElementById('pitchDelayValue');
    this.canvas = document.getElementById('pitchCanvas');
    this.targetNote = document.getElementById('pitchTargetNote');
    this.sungNote = document.getElementById('pitchSungNote');
    this.ctx = this.canvas.getContext('2d');
    this.detector = PitchDetector.forFloat32Array(WINDOW_SIZE);
    this.window = new Float32Array(WINDOW_SIZE);
    this.samplesSeen = 0;
    this.history = [];
    this.compared = 0;
    this.close = 0;
    this.lastStartedAt = null;
    this.chartRange = { min: 57, max: 81 };
    this.reference = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.sink = null;

    this.button.addEventListener('click', () => this.stream ? this.stopMic() : this.startMic());
    this.delay.addEventListener('input', () => {
      this.delayValue.textContent = `${this.delay.value} ms`;
      this.resetComparison();
    });
    this.panel.addEventListener('toggle', () => {
      document.querySelector('.player-main').classList.toggle('pitch-visible', this.panel.open);
    });
    window.addEventListener('pagehide', () => this.stopMic());
    requestAnimationFrame(() => this.drawLoop());
  }

  async loadReference() {
    if (!this.videoId) return;
    try {
      const response = await fetch(`/api/pitch/${this.videoId}`);
      if (!response.ok) throw new Error('missing');
      const reference = await response.json();
      if (reference.version !== 1 || !(reference.hop_seconds > 0) || !Array.isArray(reference.midi)) {
        throw new Error('invalid');
      }
      this.reference = reference;
      this.chartRange = pitchChartRange(reference.midi);
      this.button.disabled = false;
      this.status.textContent = '戴耳機後開啟麥克風，就能跟原唱音高對照。';
    } catch (_) {
      this.status.textContent = '這首歌尚無音高資料，請回首頁重新處理。';
    }
  }

  async startMic() {
    if (!this.reference || this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia || !this.audio.context.audioWorklet) {
      this.status.textContent = '麥克風需要 HTTPS 或 localhost，且瀏覽器需支援 AudioWorklet。';
      return;
    }
    this.button.disabled = true;
    this.status.textContent = '正在開啟麥克風…';
    try {
      await this.audio.context.resume();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      await this.audio.context.audioWorklet.addModule('/static/js/pitch_capture_worklet.js');
      this.source = this.audio.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.audio.context, 'pitch-capture');
      this.node.port.onmessage = (event) => this.onSamples(event.data);
      this.sink = this.audio.context.createGain();
      this.sink.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.sink);
      this.sink.connect(this.audio.context.destination);
      this.samplesSeen = 0;
      this.lastStartedAt = null;
      this.resetComparison();
      this.button.textContent = '關閉麥克風';
      this.status.textContent = '麥克風已開啟；播放歌曲後開始唱。';
    } catch (error) {
      this.stopMic();
      this.status.textContent = error?.name === 'NotAllowedError'
        ? '未取得麥克風權限，請允許後再試。'
        : '無法開啟麥克風，請檢查裝置與瀏覽器設定。';
    } finally {
      this.button.disabled = false;
    }
  }

  stopMic() {
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop());
    this.source = null;
    this.node = null;
    this.sink = null;
    this.stream = null;
    this.samplesSeen = 0;
    this.button.textContent = '開啟麥克風';
    this.sungNote.textContent = '—';
    this.status.dataset.grade = '';
    if (this.reference) this.status.textContent = '麥克風已關閉。';
  }

  resetComparison() {
    this.history = [];
    this.compared = 0;
    this.close = 0;
    this.result.textContent = '尚無可比對片段';
  }

  onSamples({ samples, endTime }) {
    if (!this.stream || !this.audio.playing) {
      this.samplesSeen = 0;
      return;
    }
    if (this.lastStartedAt !== this.audio.startedAt) {
      this.lastStartedAt = this.audio.startedAt;
      this.samplesSeen = 0;
      this.resetComparison();
    }
    if (endTime <= this.audio.startedAt || samples.length !== 2048) return;

    this.window.copyWithin(0, samples.length);
    this.window.set(samples, WINDOW_SIZE - samples.length);
    this.samplesSeen += samples.length;
    if (this.samplesSeen < WINDOW_SIZE) return;

    // Attribute the result to the centre of its input window, not to the time
    // when the main thread eventually receives the detector's answer.
    const songTime = captureSongTime(
      this.audio, endTime, this.audio.context.sampleRate, WINDOW_SIZE, Number(this.delay.value)
    );
    if (songTime < 0) return;

    let energy = 0;
    for (const sample of this.window) energy += sample * sample;
    const rms = Math.sqrt(energy / WINDOW_SIZE);
    const [hz, clarity] = rms >= 0.008
      ? this.detector.findPitch(this.window, this.audio.context.sampleRate)
      : [0, 0];
    const sungMidi = clarity >= 0.8 && hz >= 65 && hz <= 1200 ? hzToMidi(hz) : null;
    this.sungNote.textContent = midiToNote(sungMidi);
    const targetMidi = referenceAt(this.reference, songTime);
    const cents = sungMidi !== null && targetMidi !== null
      ? pitchDifferenceCents(sungMidi, targetMidi) : null;
    this.history.push({ time: songTime, midi: sungMidi, cents });
    this.history = this.history.filter(point => point.time >= songTime - 8);

    if (cents !== null) {
      this.compared++;
      if (Math.abs(cents) <= 50) this.close++;
      const feedback = pitchFeedback(cents);
      this.status.textContent = feedback.label;
      this.status.dataset.grade = feedback.className;
      this.result.textContent = `接近原唱 ${Math.round(this.close / this.compared * 100)}%（${this.compared} 個有效片段）`;
    } else {
      this.status.textContent = sungMidi === null ? '尚未辨識到清楚的單音' : '原唱這段沒有可比對的單音';
      this.status.dataset.grade = '';
    }
  }

  drawLoop() {
    if (this.panel.open && this.reference && this.ctx) this.draw();
    requestAnimationFrame(() => this.drawLoop());
  }

  draw() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const now = this.audio.currentTime;
    const target = referenceAt(this.reference, now) ?? referenceAt(this.reference, now + 0.2);
    const targetLabel = midiToNote(target);
    if (this.targetNote.textContent !== targetLabel) this.targetNote.textContent = targetLabel;
    if (!this.audio.playing && this.sungNote.textContent !== '—') this.sungNote.textContent = '—';
    const start = now - PAST_SECONDS;
    const plotLeft = 42;
    const plotWidth = width - plotLeft - 8;
    const x = t => plotLeft + (t - start) / (PAST_SECONDS + FUTURE_SECONDS) * plotWidth;
    const y = midi => (this.chartRange.max - midi) / (this.chartRange.max - this.chartRange.min) * height;

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#303046';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let note = Math.ceil(this.chartRange.min); note <= this.chartRange.max; note++) {
      if (![0, 4, 7, 11].includes(((note % 12) + 12) % 12)) continue;
      const py = y(note);
      ctx.beginPath();
      ctx.moveTo(plotLeft, py);
      ctx.lineTo(width, py);
      ctx.stroke();
      if (py >= 10 && py <= height - 10) {
        ctx.fillStyle = '#a8a8be';
        ctx.fillText(midiToNote(note), 7, py);
      }
    }
    ctx.strokeStyle = '#48485f';
    ctx.beginPath();
    ctx.moveTo(plotLeft, 0);
    ctx.lineTo(plotLeft, height);
    ctx.stroke();
    ctx.strokeStyle = '#6a6a80';
    ctx.beginPath();
    ctx.moveTo(x(now), 0);
    ctx.lineTo(x(now), height);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(plotLeft, 0, width - plotLeft, height);
    ctx.clip();

    const first = Math.max(0, Math.floor(start / this.reference.hop_seconds));
    const last = Math.min(this.reference.midi.length - 1, Math.ceil((now + FUTURE_SECONDS) / this.reference.hop_seconds));
    ctx.strokeStyle = '#ff3cac';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let connected = false;
    for (let i = first; i <= last; i++) {
      const midi = this.reference.midi[i];
      if (!Number.isFinite(midi)) { connected = false; continue; }
      if (connected) ctx.lineTo(x(i * this.reference.hop_seconds), y(midi));
      else ctx.moveTo(x(i * this.reference.hop_seconds), y(midi));
      connected = true;
    }
    ctx.stroke();

    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    connected = false;
    for (const point of this.history) {
      if (point.time < start || !Number.isFinite(point.midi)) { connected = false; continue; }
      if (connected) ctx.lineTo(x(point.time), y(point.midi));
      else ctx.moveTo(x(point.time), y(point.midi));
      connected = true;
    }
    ctx.stroke();
    ctx.restore();
  }
}
