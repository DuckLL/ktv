// Forward blocks with their audio-context time; never route microphone sound
// to the speakers. A larger block avoids hundreds of main-thread messages/s.
class PitchCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.used = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (!samples) return true;
    let position = 0;
    while (position < samples.length) {
      const count = Math.min(samples.length - position, this.buffer.length - this.used);
      this.buffer.set(samples.subarray(position, position + count), this.used);
      this.used += count;
      position += count;
      if (this.used === this.buffer.length) {
        const complete = this.buffer;
        this.port.postMessage({ samples: complete, endTime: currentTime + position / sampleRate }, [complete.buffer]);
        this.buffer = new Float32Array(2048);
        this.used = 0;
      }
    }
    return true;
  }
}

registerProcessor('pitch-capture', PitchCaptureProcessor);
