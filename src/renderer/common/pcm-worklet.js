// Junta os blocos de 128 amostras em ~128 ms antes de enviar (menos mensagens e pedaços).
// Mensagem 'flush' devolve o resto do buffer e { flushed: true }.
const BLOCK = 2048;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BLOCK);
    this.n = 0;
    this.port.onmessage = () => {
      if (this.n) this.port.postMessage(this.buf.slice(0, this.n));
      this.n = 0;
      this.port.postMessage({ flushed: true });
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      const k = Math.min(ch.length - i, BLOCK - this.n);
      this.buf.set(ch.subarray(i, i + k), this.n);
      this.n += k; i += k;
      if (this.n === BLOCK) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
