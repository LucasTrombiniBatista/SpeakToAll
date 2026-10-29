/* Jingle do lobby de abertura, sintetizado com Web Audio (sem arquivo de áudio).
   Pad suave em Dó maior, quatro sinos junto com as ondas da logo e um acorde final no nome. */
(function () {
  function play() {
    const AC = window.AudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.05;

    const tone = (freq, start, dur, { type = 'sine', gain = 0.06, attack = 0.02 } = {}) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0 + start);
      g.gain.linearRampToValueAtTime(gain, t0 + start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      o.connect(g).connect(master);
      o.start(t0 + start);
      o.stop(t0 + start + dur + 0.05);
    };

    [261.63, 329.63, 392].forEach((f) => tone(f, 0, 3.4, { type: 'triangle', gain: 0.03, attack: 0.8 }));
    [659.25, 783.99, 880, 1046.5].forEach((f, i) => {
      tone(f, 1.5 + i * 0.2, 1.2, { gain: 0.06 });
      tone(f * 2, 1.5 + i * 0.2, 0.5, { gain: 0.012 });
    });
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(f, 2.8, 1.4, { gain: 0.04, attack: 0.05 }));

    const close = () => ctx.close().catch(() => {});
    const timer = setTimeout(close, 4500);
    return {
      stop() {
        clearTimeout(timer);
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + 0.15);
        setTimeout(close, 250);
      },
    };
  }

  window.staJingle = { play };
})();
