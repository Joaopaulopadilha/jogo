// Sons sintetizados (sem arquivos): motor diesel, chiado do hidráulico e terra caindo.
export class Som {
  private ctx: AudioContext | null = null;
  private motorOsc!: OscillatorNode;
  private motorOsc2!: OscillatorNode;
  private motorFiltro!: BiquadFilterNode;
  private motorGanho!: GainNode;
  private hidrGanho!: GainNode;
  private hidrFiltro!: BiquadFilterNode;
  private terraGanho!: GainNode;
  private ruidoBuf: AudioBuffer | null = null;
  ligado = true;
  motorLigado = true; // falso quando o jogador está a pé: motor, hidráulico e terra calam na hora
  private mestre: GainNode | null = null;
  private volumeGeral = 1;

  // volume geral (0 a 1)
  set volume(v: number) {
    this.volumeGeral = v;
    if (this.mestre) this.mestre.gain.value = 0.55 * v;
  }

  iniciar(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const mestre = ctx.createGain();
    mestre.gain.value = 0.55 * this.volumeGeral;
    this.mestre = mestre;
    mestre.connect(ctx.destination);

    // motor: duas ondas graves batendo + filtro passa-baixa
    this.motorOsc = ctx.createOscillator();
    this.motorOsc.type = "sawtooth";
    this.motorOsc2 = ctx.createOscillator();
    this.motorOsc2.type = "square";
    this.motorFiltro = ctx.createBiquadFilter();
    this.motorFiltro.type = "lowpass";
    this.motorFiltro.frequency.value = 300;
    this.motorFiltro.Q.value = 4;
    this.motorGanho = ctx.createGain();
    this.motorGanho.gain.value = 0.16;
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    this.motorOsc.connect(this.motorFiltro);
    this.motorOsc2.connect(g2).connect(this.motorFiltro);
    this.motorFiltro.connect(this.motorGanho).connect(mestre);
    this.motorOsc.start();
    this.motorOsc2.start();

    // ruído branco reaproveitado no hidráulico e na terra
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    this.ruidoBuf = buf;
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ruido = () => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start();
      return s;
    };
    this.hidrFiltro = ctx.createBiquadFilter();
    this.hidrFiltro.type = "bandpass";
    this.hidrFiltro.frequency.value = 1400;
    this.hidrFiltro.Q.value = 3;
    this.hidrGanho = ctx.createGain();
    this.hidrGanho.gain.value = 0;
    ruido().connect(this.hidrFiltro).connect(this.hidrGanho).connect(mestre);

    const terraFiltro = ctx.createBiquadFilter();
    terraFiltro.type = "lowpass";
    terraFiltro.frequency.value = 500;
    this.terraGanho = ctx.createGain();
    this.terraGanho.gain.value = 0;
    ruido().connect(terraFiltro).connect(this.terraGanho).connect(mestre);
  }

  // estampido do fuzil: estalo de ruído + pancada grave; `volume` 0 a 1 (tiros de longe soam mais baixo)
  tiro(volume = 1): void {
    const ctx = this.ctx;
    if (!ctx || !this.mestre || !this.ruidoBuf || !this.ligado || volume <= 0.01) return;
    const t = ctx.currentTime;
    const ruido = ctx.createBufferSource();
    ruido.buffer = this.ruidoBuf;
    ruido.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "bandpass";
    filtro.frequency.setValueAtTime(2600, t);
    filtro.frequency.exponentialRampToValueAtTime(500, t + 0.12);
    filtro.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    ruido.connect(filtro).connect(g).connect(this.mestre);
    ruido.start(t, Math.random(), 0.16);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.8 * volume, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g2).connect(this.mestre);
    osc.start(t);
    osc.stop(t + 0.17);
  }

  // recarga do pente: tira o pente (clique), encaixa o novo e puxa o ferrolho
  recarga(): void {
    for (const [atraso, freq] of [[0.12, 900], [0.95, 650], [1.35, 1100]] as [number, number][]) this.clique(atraso, freq);
  }

  // marca de acerto: tique agudo (mais grave e longo no tiro na cabeça)
  acerto(cabeca: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.mestre || !this.ligado) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = cabeca ? 1500 : 1000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (cabeca ? 0.16 : 0.08));
    osc.connect(g).connect(this.mestre);
    osc.start(t);
    osc.stop(t + 0.18);
  }

  private clique(atraso: number, freq: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.mestre || !this.ruidoBuf || !this.ligado) return;
    const t = ctx.currentTime + atraso;
    const ruido = ctx.createBufferSource();
    ruido.buffer = this.ruidoBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq * 2;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    ruido.connect(f).connect(g).connect(this.mestre);
    ruido.start(t, Math.random(), 0.06);
  }

  // giro: 0 (marcha lenta) a 1; hidraulico e terra: 0 a 1
  atualizar(giro: number, hidraulico: number, terra: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const liga = this.ligado && this.motorLigado ? 1 : 0;
    if (!liga) {
      // desligado: zera já (sem a suavização de ~0,2 s do motor)
      for (const g of [this.motorGanho, this.hidrGanho, this.terraGanho]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(0, t);
      }
      return;
    }
    const f = 34 + giro * 46 + hidraulico * 10;
    this.motorOsc.frequency.setTargetAtTime(f, t, 0.15);
    this.motorOsc2.frequency.setTargetAtTime(f * 0.503, t, 0.15);
    this.motorFiltro.frequency.setTargetAtTime(220 + giro * 500, t, 0.2);
    this.motorGanho.gain.setTargetAtTime((0.12 + giro * 0.1) * liga, t, 0.2);
    this.hidrGanho.gain.setTargetAtTime(hidraulico * 0.07 * liga, t, 0.08);
    this.hidrFiltro.frequency.setTargetAtTime(1100 + hidraulico * 900, t, 0.1);
    this.terraGanho.gain.setTargetAtTime(Math.min(terra, 1) * 0.35 * liga, t, 0.05);
  }
}
