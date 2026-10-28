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
  ligado = true;

  iniciar(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    const mestre = ctx.createGain();
    mestre.gain.value = 0.55;
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

  // giro: 0 (marcha lenta) a 1; hidraulico e terra: 0 a 1
  atualizar(giro: number, hidraulico: number, terra: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const liga = this.ligado ? 1 : 0;
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
