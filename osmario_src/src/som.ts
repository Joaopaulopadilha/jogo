// Sons sintetizados (sem arquivos): bipes de videogame e uma batida synthwave de fundo.

import type { Evento } from "./jogo.ts";

export class Som {
  private ctx: AudioContext | null = null;
  private saida: GainNode | null = null;
  private relogio = 0;
  private passo = 0;
  private proxima = 0;
  ligado = localStorage.getItem("osmario-som") !== "0";

  // o navegador só libera áudio depois de um toque ou tecla
  iniciar(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.saida = this.ctx.createGain();
      this.saida.gain.value = this.ligado ? 0.5 : 0;
      this.saida.connect(this.ctx.destination);
    }
    void this.ctx.resume();
  }

  alternar(): boolean {
    this.ligado = !this.ligado;
    localStorage.setItem("osmario-som", this.ligado ? "1" : "0");
    if (this.saida) this.saida.gain.value = this.ligado ? 0.5 : 0;
    return this.ligado;
  }

  private nota(freq: number, dur: number, tipo: OscillatorType, vol: number, quando = 0, ate?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.saida || !this.ligado) return;
    const t = ctx.currentTime + quando;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, t);
    if (ate) o.frequency.exponentialRampToValueAtTime(ate, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.saida);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  tocar(e: Evento): void {
    const seq = (notas: number[], dt: number, tipo: OscillatorType = "square", vol = 0.18): void => notas.forEach((f, i) => this.nota(f, dt * 1.4, tipo, vol, i * dt));
    switch (e) {
      case "pulo": this.nota(260, 0.18, "square", 0.14, 0, 620); break;
      case "pulo2": this.nota(430, 0.16, "square", 0.13, 0, 980); break;
      case "tiro": this.nota(760, 0.13, "sawtooth", 0.13, 0, 170); break;
      case "moeda": seq([988, 1319], 0.07); break;
      case "pisao": this.nota(300, 0.16, "sawtooth", 0.22, 0, 80); break;
      case "bate": this.nota(120, 0.08, "square", 0.2, 0, 90); break;
      case "quebra": this.nota(180, 0.2, "sawtooth", 0.24, 0, 40); break;
      case "coxinha": seq([330, 392, 494], 0.08, "triangle", 0.22); break;
      case "cresceu": seq([392, 523, 659, 784, 1047], 0.07); break;
      case "dano": seq([500, 370, 250], 0.09, "sawtooth"); break;
      case "morte": seq([494, 440, 370, 294, 196], 0.13, "triangle", 0.25); break;
      case "vida": seq([659, 784, 1319, 1047, 1175, 1568], 0.09); break;
      case "vitoria": seq([523, 659, 784, 1047, 784, 1047, 1319], 0.13, "square", 0.2); break;
    }
  }

  // baixo pulsando em quatro acordes, bem baixinho; chamado a cada quadro enquanto se joga
  musica(dt: number): void {
    if (!this.ctx || !this.ligado) return;
    this.relogio += dt;
    if (this.relogio < this.proxima) return;
    this.proxima = this.relogio + 0.21;
    const baixos = [55, 55, 43.65, 49]; // Lá, Lá, Fá, Sol
    const b = baixos[Math.floor(this.passo / 8) % 4];
    this.nota(b * (this.passo % 2 ? 2 : 1), 0.17, "sawtooth", 0.07);
    if (this.passo % 4 === 2) this.nota(b * 8, 0.1, "triangle", 0.05);
    this.passo++;
  }
}
