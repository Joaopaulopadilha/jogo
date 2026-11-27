// Desenha o jogo no canvas: fundo de neon, blocos, moedas, inimigos e o herói (o sprite em public/heroi.png).

import { contorno, criarFundo, neon, tela, type Fundo } from "./cenario.ts";
import { CHAO, LINHAS, type Cenario } from "./fases.ts";
import { ALTURA_MUNDO, T, type Inimigo, type Jogo } from "./jogo.ts";

// heroi.png: 3 quadros iguais (parado, andando, correndo), pés na base; o meio do corpo fica um pouco atrás da cabeça
const QUADRO_W = 107;
const QUADRO_H = 126;
const MEIO_X = 58;

const LUZ: Record<Cenario, [string, string]> = { la: ["#ff3fa4", "#31e8ff"], wall: ["#00ffa8", "#ffd23f"], neon: ["#4ff2ff", "#ff2fd0"] };

export class Desenho {
  private readonly g: CanvasRenderingContext2D;
  private fundo: Fundo | null = null;
  private cenario: Cenario | null = null;
  private blocos = new Map<string, HTMLCanvasElement>();
  camX = 0;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly heroi: HTMLImageElement) {
    this.g = canvas.getContext("2d")!;
  }

  private preparar(c: Cenario): void {
    if (this.cenario === c) return;
    this.cenario = c;
    this.fundo = criarFundo(c);
    this.blocos.clear();
  }

  // cada tipo de bloco é pintado uma vez (com o brilho já embutido) e depois só copiado
  private imagemBloco(tipo: string): HTMLCanvasElement {
    const feito = this.blocos.get(tipo);
    if (feito) return feito;
    const M = 10; // margem para o brilho vazar
    const [img, g] = tela(T + M * 2, T + M * 2);
    g.translate(M, M);
    const [a, b] = LUZ[this.cenario!];
    const caixa = (cor: string): void => { g.fillStyle = cor; g.fillRect(0, 0, T, T); };
    if (tipo === "topo" || tipo === "chao") {
      caixa("#17142a");
      g.fillStyle = "#211d3a";
      g.fillRect(2, 4, T / 2 - 3, T - 8);
      g.fillRect(T / 2 + 1, 4, T / 2 - 3, T - 8);
      if (tipo === "topo") {
        g.fillStyle = "#4a4568"; g.fillRect(0, 0, T, 11);
        g.save(); g.shadowColor = a; g.shadowBlur = 10; g.fillStyle = a; g.fillRect(0, 0, T, 3); g.restore();
        g.fillStyle = "#2d2948"; g.fillRect(T - 2, 3, 2, 8);
      }
    } else if (tipo === "degrau") {
      caixa("#26213f");
      contorno(g, 3, 3, T - 6, T - 6, b, 2, 8);
      g.fillStyle = "#332c55"; g.fillRect(10, 10, T - 20, T - 20);
    } else if (tipo === "B") {
      caixa("#3a1638");
      g.fillStyle = "#5a2352";
      for (let l = 0; l < 3; l++) {
        for (let x = (l % 2) * 12 - 24; x < T; x += 24) {
          const x0 = Math.max(1, x + 1);
          const x1 = Math.min(T - 1, x + 23);
          if (x1 > x0) g.fillRect(x0, l * 16 + 1, x1 - x0, 14);
        }
      }
      contorno(g, 1, 1, T - 2, T - 2, a, 1.5, 6);
    } else if (tipo === "?" || tipo === "C" || tipo === "F") {
      caixa(tipo === "F" ? "#2a0508" : "#241a05");
      const cor = tipo === "F" ? "#ff3b30" : tipo === "C" ? "#ff8a2f" : "#ffd23f";
      contorno(g, 3, 3, T - 6, T - 6, cor, 3, 12);
      neon(g, "?", T / 2, T / 2 + 2, cor, 30);
    } else if (tipo === "U") {
      caixa("#232230");
      contorno(g, 3, 3, T - 6, T - 6, "#55536e", 2, 2);
      g.fillStyle = "#4a4862";
      for (const [x, y] of [[8, 8], [T - 12, 8], [8, T - 12], [T - 12, T - 12]]) g.fillRect(x, y, 4, 4);
    } else if (tipo === "=") {
      g.fillStyle = "#2b2947"; g.fillRect(0, 0, T, 18);
      g.save(); g.shadowColor = b; g.shadowBlur = 12; g.fillStyle = b; g.fillRect(0, 0, T, 4); g.restore();
      g.strokeStyle = "#5c5890"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 18); g.lineTo(T / 2, 6); g.lineTo(T, 18); g.stroke();
    } else {
      // coluna de metal com anéis de neon (o "cano"): metade esquerda/direita, topo ou corpo
      const esq = tipo.includes("e");
      const topo = tipo.includes("t");
      const x0 = esq ? (topo ? 0 : 5) : 0;
      const w = topo ? T : T - 5;
      const grad = g.createLinearGradient(esq ? 0 : -T, 0, esq ? T * 2 : T, 0);
      grad.addColorStop(0, "#161a30"); grad.addColorStop(0.3, "#59628c"); grad.addColorStop(0.55, "#2c3354"); grad.addColorStop(1, "#10132a");
      g.fillStyle = grad;
      g.fillRect(x0, 0, w, T);
      g.save(); g.shadowColor = b; g.shadowBlur = 10; g.fillStyle = b;
      if (topo) { g.fillRect(x0, 0, w, 4); g.fillRect(x0, 17, w, 2); }
      else g.fillRect(x0, T / 2, w, 3);
      g.restore();
    }
    this.blocos.set(tipo, img);
    return img;
  }

  private tipoVisual(j: Jogo, col: number, lin: number): string {
    const b = j.bloco(col, lin);
    if (b === "#") return lin < CHAO ? "degrau" : j.bloco(col, lin - 1) === "#" && lin > CHAO ? "chao" : "topo";
    if (b === "P") {
      // os canos têm 2 de largura: conta para a esquerda para saber de que lado está
      let k = 0;
      while (j.bloco(col - 1 - k, lin) === "P") k++;
      return `P${k % 2 === 0 ? "e" : "d"}${j.bloco(col, lin - 1) !== "P" ? "t" : ""}`;
    }
    return b;
  }

  desenhar(j: Jogo, t: number): void {
    this.preparar(j.fase.cenario);
    const g = this.g;
    const W = this.canvas.width;
    const H = this.canvas.height;
    // pelo menos 12 blocos de largura; a altura toda do mundo sempre aparece
    const escala = Math.min(H / ALTURA_MUNDO, W / (12 * T));
    const vista = W / escala;
    const alvo = j.h.x + j.h.w / 2 - vista * (j.h.direcao > 0 ? 0.4 : 0.55);
    const limite = Math.max(0, j.fase.largura * T - vista);
    const destino = Math.max(0, Math.min(limite, alvo));
    this.camX = Math.abs(destino - this.camX) > vista ? destino : this.camX + (destino - this.camX) * 0.12;
    const camX = this.camX;

    this.fundo!.desenhar(g, W, H, escala, camX, t);
    g.save();
    g.translate(0, H - ALTURA_MUNDO * escala);
    g.scale(escala, escala);
    g.translate(-Math.round(camX), 0);
    g.imageSmoothingEnabled = true;

    this.chegada(j, t);
    const de = Math.max(0, Math.floor(camX / T) - 1);
    const ate = Math.min(j.fase.largura - 1, Math.ceil((camX + vista) / T) + 1);
    for (let lin = 0; lin < LINHAS; lin++) {
      for (let col = de; col <= ate; col++) {
        const b = j.bloco(col, lin);
        if (b === " ") continue;
        if (b === "o") { this.moeda((col + 0.5) * T, (lin + 0.5) * T, t + col * 0.3); continue; }
        const pulo = j.batidos.get(`${col},${lin}`);
        const dy = pulo ? -Math.sin((pulo / 0.18) * Math.PI) * 12 : 0;
        g.drawImage(this.imagemBloco(this.tipoVisual(j, col, lin)), col * T - 10, lin * T - 10 + dy);
        if (b === "?" || b === "C" || b === "F") {
          // pisca para chamar atenção
          g.globalAlpha = 0.18 * Math.max(0, Math.sin(t * 5));
          g.fillStyle = "#fff";
          g.fillRect(col * T + 4, lin * T + 4 + dy, T - 8, T - 8);
          g.globalAlpha = 1;
        }
      }
    }
    for (const c of j.itens) {
      if (c.tipo === "fogo") this.chama(c.x + c.w / 2, c.y + c.h, 1.15, t);
      else this.coxinha(c.x, c.y, c.w, c.h);
    }
    for (const i of j.inimigos) if (i.x > camX - 80 && i.x < camX + vista + 80) this.inimigo(i, t);
    this.heroiNaTela(j, t);
    for (const b of j.tiros) this.bola(b.x + b.w / 2, b.y + b.h / 2, Math.sign(b.vx), t);
    for (const e of j.efeitos) {
      if (e.tipo === "moeda") this.moeda(e.x, e.y, t * 3);
      else if (e.tipo === "faisca") { g.globalAlpha = Math.min(1, e.t * 4); g.fillStyle = "#ffd27a"; g.fillRect(e.x - 3, e.y - 3, 6, 6); g.globalAlpha = 1; }
      else if (e.tipo === "caco") { g.fillStyle = "#8a357c"; g.fillRect(e.x - 8, e.y - 8, 16, 16); }
      else neon(g, e.texto ?? "", e.x, e.y, "#ffd23f", 18);
    }
    g.restore();
  }

  private heroiNaTela(j: Jogo, t: number): void {
    const g = this.g;
    const h = j.h;
    if (h.invencivel > 0 && Math.floor(t * 14) % 2 === 0) return; // pisca depois de levar dano
    let quadro = 0;
    if (!h.noChao) quadro = 2;
    else if (Math.abs(h.vx) > 25) quadro = Math.abs(h.vx) > 290 ? [2, 1][Math.floor(h.passos / 52) % 2] : [1, 0][Math.floor(h.passos / 34) % 2];
    const altura = h.h * 1.14;
    const esc = altura / QUADRO_H;
    g.save();
    g.translate(h.x + h.w / 2, h.y + h.h + 1);
    if (j.estado === "morrendo") { g.translate(0, -altura / 2); g.rotate((1.6 - j.espera) * 5); g.translate(0, altura / 2); }
    if (h.direcao < 0) g.scale(-1, 1);
    g.imageSmoothingEnabled = false;
    // um contorno de luz para ele se destacar do fundo escuro; laranja e pulsando quando tem o foguinho
    g.shadowColor = h.fogo ? "#ff6a1f" : "rgba(150,240,255,0.85)";
    g.shadowBlur = h.fogo ? 16 + Math.sin(t * 12) * 5 : 9;
    g.drawImage(this.heroi, quadro * QUADRO_W, 0, QUADRO_W, QUADRO_H, -MEIO_X * esc, -altura, QUADRO_W * esc, altura);
    g.restore();
  }

  private moeda(x: number, y: number, t: number): void {
    const g = this.g;
    const largura = Math.max(0.12, Math.abs(Math.cos(t * 3)));
    g.save();
    g.translate(x, y);
    g.scale(largura, 1);
    g.shadowColor = "#ffd23f";
    g.shadowBlur = 12;
    g.fillStyle = "#ffd23f";
    g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#8a5a00";
    g.font = "900 17px 'Arial Black', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("$", 0, 1);
    g.restore();
  }

  // o item do foguinho: uma chama dançando
  private chama(x: number, base: number, esc: number, t: number): void {
    const g = this.g;
    g.save();
    g.translate(x, base);
    g.scale(esc, esc);
    g.shadowColor = "#ff5a1f";
    g.shadowBlur = 20;
    const lingua = (larg: number, alt: number, cor: string): void => {
      const bal = Math.sin(t * 11) * 3;
      g.fillStyle = cor;
      g.beginPath();
      g.moveTo(bal, -alt);
      g.bezierCurveTo(larg * 0.35 + bal, -alt * 0.7, larg, -alt * 0.45, larg * 0.7, -alt * 0.14);
      g.quadraticCurveTo(0, alt * 0.08, -larg * 0.7, -alt * 0.14);
      g.bezierCurveTo(-larg, -alt * 0.45, -larg * 0.25, -alt * 0.5, bal, -alt);
      g.fill();
    };
    lingua(17, 36, "#ff3b1f");
    g.shadowBlur = 0;
    lingua(11, 25, "#ff9d1f");
    lingua(6, 15, "#fff1a8");
    g.restore();
  }

  // a bola de fogo atirada, com rastro
  private bola(x: number, y: number, dir: number, t: number): void {
    const g = this.g;
    g.save();
    g.shadowColor = "#ff5a1f";
    g.shadowBlur = 18;
    for (let k = 3; k >= 1; k--) {
      g.globalAlpha = 0.18 * (4 - k);
      g.fillStyle = "#ff5a1f";
      g.beginPath(); g.arc(x - dir * k * 8, y + Math.sin(t * 30 + k) * 2, 8 - k, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = "#ff8a1f"; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff3b0"; g.beginPath(); g.arc(x + Math.cos(t * 26) * 2, y + Math.sin(t * 26) * 2, 4.5, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  private coxinha(x: number, y: number, w: number, h: number): void {
    const g = this.g;
    g.save();
    g.translate(x + w / 2, y);
    g.shadowColor = "#ffb13d";
    g.shadowBlur = 16;
    g.fillStyle = "#e89a2c";
    g.beginPath();
    g.moveTo(0, -2);
    g.bezierCurveTo(8, 6, w / 2 + 3, 16, w / 2 - 2, h - 7);
    g.quadraticCurveTo(0, h + 5, -w / 2 + 2, h - 7);
    g.bezierCurveTo(-w / 2 - 3, 16, -8, 6, 0, -2);
    g.fill();
    g.shadowBlur = 0;
    g.fillStyle = "#ffc35c";
    for (const [px, py, r] of [[-5, 15, 4], [3, 9, 3], [6, 22, 3.5], [-7, 25, 2.5]]) { g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }

  private inimigo(i: Inimigo, t: number): void {
    const g = this.g;
    g.save();
    g.translate(i.x + i.w / 2, i.y + i.h);
    if (i.achatado > 0) g.scale(1.2, 0.28);
    if (i.tipo === "barata") {
      if (i.vx > 0) g.scale(-1, 1);
      g.strokeStyle = "#d8895a"; g.lineWidth = 3; g.lineCap = "round";
      for (let k = 0; k < 3; k++) {
        const p = Math.sin(t * 22 + k * 2.1) * 5;
        g.beginPath(); g.moveTo(-8 + k * 10, -8); g.lineTo(-13 + k * 10 + p, 0); g.stroke();
      }
      g.beginPath(); g.moveTo(-16, -20); g.quadraticCurveTo(-30, -40, -34, -24 + Math.sin(t * 9) * 4); g.stroke();
      g.beginPath(); g.moveTo(-12, -22); g.quadraticCurveTo(-14, -42, -26, -40 + Math.cos(t * 8) * 4); g.stroke();
      g.shadowColor = "#ff7a3d"; g.shadowBlur = 10;
      g.fillStyle = "#8a3b1c"; g.beginPath(); g.ellipse(3, -14, 19, 12, 0, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      g.fillStyle = "#b5582c"; g.beginPath(); g.ellipse(6, -18, 12, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#5c2410"; g.beginPath(); g.arc(-15, -15, 9, 0, Math.PI * 2); g.fill();
      g.shadowColor = "#ff2040"; g.shadowBlur = 8; g.fillStyle = "#ff3b5c";
      g.beginPath(); g.arc(-18, -17, 3, 0, Math.PI * 2); g.fill();
    } else {
      g.strokeStyle = "#8f97c4"; g.lineWidth = 4;
      g.beginPath(); g.moveTo(-22, -22); g.lineTo(22, -22); g.stroke();
      g.fillStyle = "rgba(210,235,255,0.55)";
      const giro = 7 + Math.abs(Math.sin(t * 40)) * 11;
      for (const x of [-22, 22]) { g.beginPath(); g.ellipse(x, -27, giro, 2.5, 0, 0, Math.PI * 2); g.fill(); }
      g.shadowColor = "#4ff2ff"; g.shadowBlur = 12;
      g.fillStyle = "#3d4470"; g.beginPath(); g.ellipse(0, -13, 17, 12, 0, 0, Math.PI * 2); g.fill();
      g.shadowColor = g.fillStyle = Math.floor(t * 4) % 2 ? "#ff2f5f" : "#4ff2ff";
      g.beginPath(); g.arc(0, -12, 5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // o fim da fase: um poste com bandeira e o portal de neon
  private chegada(j: Jogo, t: number): void {
    const g = this.g;
    const x = (j.fase.chegada + 0.5) * T;
    const chao = CHAO * T;
    g.fillStyle = "#6a6f99";
    g.fillRect(x - 4, chao - 330, 8, 330);
    const [a, b] = LUZ[j.fase.cenario];
    g.save();
    g.shadowColor = a; g.shadowBlur = 18; g.fillStyle = a;
    g.beginPath(); g.moveTo(x + 4, chao - 328);
    g.quadraticCurveTo(x + 46, chao - 318 + Math.sin(t * 5) * 8, x + 84, chao - 296);
    g.quadraticCurveTo(x + 44, chao - 286 + Math.cos(t * 5) * 6, x + 4, chao - 262);
    g.fill();
    g.beginPath(); g.arc(x, chao - 336, 8, 0, Math.PI * 2); g.fill();
    g.restore();
    const porta = x + 3 * T;
    g.fillStyle = "#0c0a1c";
    g.fillRect(porta - 70, chao - 190, 140, 190);
    contorno(g, porta - 70, chao - 190, 140, 190, b, 3, 16);
    contorno(g, porta - 26, chao - 92, 52, 92, a, 3, 14);
    neon(g, "CHEGADA", porta, chao - 150, a, 22);
    neon(g, "★ ★ ★", porta, chao - 118, "#ffd23f", 16);
  }
}
