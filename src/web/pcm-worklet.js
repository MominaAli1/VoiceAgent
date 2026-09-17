/**
 * AudioWorklet that turns native-rate microphone audio into fixed frames of
 * 16 kHz mono PCM16 little-endian (design D21).
 *
 * Runs on the audio rendering thread. It cannot import modules, so the target
 * rate and frame size arrive through `processorOptions` from src/web/mic.js,
 * which reads them from src/config.js.
 */

class PcmDownsampler extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    const { targetRate, frameSamples } = processorOptions;

    // `sampleRate` is the AudioContext's native rate, a global in this scope.
    this.ratio = sampleRate / targetRate;
    this.frameSamples = frameSamples;

    // Box filter: average every input sample that falls inside one output
    // sample's window, then emit. `phase` carries the fractional remainder so
    // non-integer ratios (44.1 kHz → 16 kHz is 2.75625) don't drift.
    this.sum = 0;
    this.count = 0;
    this.phase = 0;

    this.frame = new ArrayBuffer(frameSamples * 2);
    this.view = new DataView(this.frame);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      this.sum += channel[i];
      this.count++;
      this.phase += 1;
      if (this.phase < this.ratio) continue;

      this.phase -= this.ratio;
      const average = this.sum / this.count;
      this.sum = 0;
      this.count = 0;
      this.#push(average);
    }
    return true;
  }

  #push(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    this.view.setInt16(this.filled * 2, int16, true);
    this.filled++;

    if (this.filled === this.frameSamples) {
      // Transfer, don't copy: the main thread never touches per-sample data.
      this.port.postMessage(this.frame, [this.frame]);
      this.frame = new ArrayBuffer(this.frameSamples * 2);
      this.view = new DataView(this.frame);
      this.filled = 0;
    }
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
