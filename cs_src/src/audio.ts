// audio.ts
// Sons sintetizados com WebAudio (sem arquivos)

let ac: AudioContext | null = null;

function ctx(): AudioContext {
  if (!ac) ac = new AudioContext();
  if (ac.state === "suspended") void ac.resume();
  return ac;
}

export function somExplosao(volume = 1): void {
  const a = ctx();
  const dur = 0.8;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filtro = a.createBiquadFilter();
  filtro.type = "lowpass";
  filtro.frequency.value = 500;
  const g = a.createGain();
  g.gain.value = 0.9 * volume;
  src.connect(filtro).connect(g).connect(a.destination);
  src.start();
}

export function somTiro(volume = 1, pistola = false): void {
  const a = ctx();
  const dur = pistola ? 0.06 : 0.09;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = 0.35 * volume;
  src.connect(g).connect(a.destination);
  src.start();
}

function tom(freq: number, dur: number, vol: number, tipo: OscillatorType = "square"): void {
  const a = ctx();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = tipo;
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

export function somAcerto(head: boolean): void {
  tom(head ? 1400 : 900, 0.07, 0.12);
}

export function somDano(): void {
  tom(120, 0.18, 0.2, "sawtooth");
}

export function somMorte(): void {
  tom(220, 0.5, 0.2, "sawtooth");
}
