// Os fundos de neon, um por fase: Los Angeles ao entardecer, Wall Street e o centro "cyberpunk" com chuva.
// Cada camada é desenhada uma vez numa tela fora de vista (o brilho do neon é caro) e depois só deslizada, com paralaxe.

import type { Cenario } from "./fases.ts";

const ALTURA = 576;
const FAIXA = 1600; // largura que se repete

export function tela(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function semente(s: number): () => number {
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// letreiro de neon: halo colorido e miolo claro
export function neon(g: CanvasRenderingContext2D, texto: string, x: number, y: number, cor: string, tam: number, fonte = "'Arial Black', Impact, sans-serif"): void {
  g.save();
  g.font = `900 ${tam}px ${fonte}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = cor;
  g.shadowBlur = tam * 0.7;
  g.fillStyle = cor;
  g.fillText(texto, x, y);
  g.fillText(texto, x, y);
  g.shadowBlur = tam * 0.2;
  g.globalAlpha = 0.75;
  g.fillStyle = "#ffffff";
  g.fillText(texto, x, y);
  g.restore();
}

export function contorno(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cor: string, esp = 3, brilho = 14): void {
  g.save();
  g.strokeStyle = cor;
  g.lineWidth = esp;
  g.shadowColor = cor;
  g.shadowBlur = brilho;
  g.strokeRect(x, y, w, h);
  g.strokeRect(x, y, w, h);
  g.restore();
}

function predio(g: CanvasRenderingContext2D, rnd: () => number, x: number, w: number, alto: number, corpo: string, janelas: string[], densidade: number): void {
  const y = ALTURA - alto;
  g.fillStyle = corpo;
  g.fillRect(x, y, w, alto);
  for (let jy = y + 10; jy < ALTURA - 14; jy += 16) {
    for (let jx = x + 7; jx < x + w - 9; jx += 14) {
      if (rnd() > densidade) continue;
      g.fillStyle = janelas[Math.floor(rnd() * janelas.length)];
      g.globalAlpha = 0.35 + rnd() * 0.65;
      g.fillRect(jx, jy, 6, 8);
    }
  }
  g.globalAlpha = 1;
}

function palmeira(g: CanvasRenderingContext2D, x: number, alto: number, cor: string): void {
  const topo = ALTURA - alto;
  g.strokeStyle = cor;
  g.fillStyle = cor;
  g.lineCap = "round";
  g.lineWidth = 11;
  g.beginPath();
  g.moveTo(x, ALTURA);
  g.quadraticCurveTo(x + 26, ALTURA - alto * 0.5, x + 10, topo);
  g.stroke();
  for (const [dx, dy, cx, cy] of [[-78, 26, -46, -26], [-60, -22, -28, -42], [-4, -52, 4, -40], [58, -30, 22, -46], [80, 20, 52, -26], [-50, 52, -44, 2], [52, 50, 46, 0]]) {
    g.beginPath();
    g.moveTo(x + 10, topo);
    g.quadraticCurveTo(x + 10 + cx, topo + cy, x + 10 + dx, topo + dy);
    g.quadraticCurveTo(x + 10 + cx * 0.6, topo + cy * 0.4 + 6, x + 10, topo + 6);
    g.fill();
  }
}

// placa vertical ou horizontal com moldura de neon
function placa(g: CanvasRenderingContext2D, texto: string, x: number, y: number, cor: string, tam: number, vertical = false): void {
  g.save();
  g.font = `900 ${tam}px 'Arial Black', Impact, sans-serif`;
  const w = vertical ? tam * 1.5 : g.measureText(texto).width + tam;
  const h = vertical ? texto.length * tam * 1.05 + tam * 0.6 : tam * 1.7;
  g.fillStyle = "rgba(10,6,24,0.85)";
  g.fillRect(x - w / 2, y, w, h);
  g.restore();
  contorno(g, x - w / 2, y, w, h, cor, 2.5, 16);
  if (vertical) [...texto].forEach((c, i) => neon(g, c, x, y + tam * 0.85 + i * tam * 1.05, cor, tam));
  else neon(g, texto, x, y + h / 2 + 1, cor, tam);
}

interface Camada { img: HTMLCanvasElement; paralaxe: number }

export interface Fundo {
  desenhar(g: CanvasRenderingContext2D, larg: number, alt: number, escala: number, camX: number, t: number): void;
}

export function criarFundo(tipo: Cenario): Fundo {
  const rnd = semente(tipo === "la" ? 11 : tipo === "wall" ? 23 : 37);
  const camadas: Camada[] = [];
  const nova = (paralaxe: number, pintar: (g: CanvasRenderingContext2D) => void): void => {
    const [img, g] = tela(FAIXA, ALTURA);
    pintar(g);
    camadas.push({ img, paralaxe });
  };

  if (tipo === "la") {
    nova(0.1, (g) => {
      // morros com o letreiro
      g.fillStyle = "#3a1650";
      g.beginPath();
      g.moveTo(0, ALTURA);
      for (let x = 0; x <= FAIXA; x += 40) g.lineTo(x, 330 - Math.sin((x / FAIXA) * Math.PI * 4) * 55 - Math.sin((x / FAIXA) * Math.PI * 10) * 18);
      g.lineTo(FAIXA, ALTURA);
      g.fill();
      neon(g, "HOLLYWOOD", 420, 268, "#fff1c9", 30);
    });
    nova(0.25, (g) => {
      for (let x = 0; x < FAIXA - 60; x += 70 + rnd() * 50) predio(g, rnd, x, 54 + rnd() * 50, 130 + rnd() * 130, "#2a0f45", ["#ffd36b", "#ff7ac8"], 0.28);
      placa(g, "HOTEL", 260, 250, "#ff3fa4", 22, true);
      placa(g, "DINER", 690, 330, "#31e8ff", 28);
      placa(g, "SUNSET BLVD", 1130, 296, "#ffb13d", 24);
      placa(g, "MOTEL", 1460, 270, "#9dff5c", 20, true);
    });
    nova(0.5, (g) => {
      for (let x = 40; x < FAIXA - 100; x += 170 + rnd() * 120) palmeira(g, x, 200 + rnd() * 150, "#14072a");
    });
  } else if (tipo === "wall") {
    nova(0.12, (g) => {
      for (let x = 0; x < FAIXA - 40; x += 46 + rnd() * 26) predio(g, rnd, x, 40 + rnd() * 30, 220 + rnd() * 230, "#10193a", ["#7fb4ff", "#ffe9a8"], 0.3);
    });
    nova(0.28, (g) => {
      for (let x = 10; x < FAIXA - 130; x += 130 + rnd() * 60) {
        const w = 90 + rnd() * 40;
        const alto = 250 + rnd() * 190;
        predio(g, rnd, x, w, alto, "#0b1126", ["#ffd36b", "#9fe8ff", "#ffffff"], 0.42);
        contorno(g, x + 1, ALTURA - alto, w - 2, 3, rnd() < 0.5 ? "#00ffa8" : "#ff3f6e", 2, 12);
      }
      placa(g, "WALL ST", 300, 250, "#00ffa8", 32);
      placa(g, "BANK", 640, 190, "#ffd23f", 26, true);
      placa(g, "NYSE", 920, 300, "#31e8ff", 34);
      placa(g, "STOCKS ▲", 1260, 240, "#00ffa8", 24);
      placa(g, "CASH", 1500, 200, "#ff3f6e", 24, true);
    });
    nova(0.55, (g) => {
      // colunas da bolsa e postes
      for (const cx of [180, 980]) {
        g.fillStyle = "#1b2038";
        g.fillRect(cx - 14, 372, 268, 22);
        for (let i = 0; i < 6; i++) g.fillRect(cx + i * 46, 394, 22, 182);
        g.beginPath(); g.moveTo(cx - 20, 372); g.lineTo(cx + 120, 320); g.lineTo(cx + 260, 372); g.fill();
        contorno(g, cx - 14, 372, 268, 22, "#ffd23f", 2, 12);
        neon(g, "$", cx + 120, 350, "#ffd23f", 28);
      }
      for (const px of [620, 1420]) {
        g.fillStyle = "#171b30";
        g.fillRect(px, 390, 6, 186);
        g.save(); g.shadowColor = "#ffe9a8"; g.shadowBlur = 26; g.fillStyle = "#fff4cf"; g.fillRect(px - 12, 384, 30, 10); g.restore();
      }
    });
  } else {
    nova(0.12, (g) => {
      for (let x = 0; x < FAIXA - 40; x += 40 + rnd() * 30) predio(g, rnd, x, 36 + rnd() * 34, 200 + rnd() * 240, "#150b2e", ["#ff4fd8", "#4ff2ff"], 0.2);
    });
    nova(0.3, (g) => {
      for (let x = 20; x < FAIXA - 140; x += 140 + rnd() * 70) {
        const w = 100 + rnd() * 40;
        const alto = 240 + rnd() * 180;
        predio(g, rnd, x, w, alto, "#0e0822", ["#ff4fd8", "#4ff2ff", "#b7ff4f"], 0.3);
        contorno(g, x + 4, ALTURA - alto + 4, w - 8, alto, rnd() < 0.5 ? "#ff4fd8" : "#4ff2ff", 1.5, 10);
      }
      placa(g, "NEON", 190, 180, "#ff2fd0", 40);
      placa(g, "ARCADE", 560, 290, "#4ff2ff", 30);
      placa(g, "OPEN 24H", 880, 210, "#b7ff4f", 26);
      placa(g, "ラーメン", 1180, 250, "#ff9d2f", 30, true);
      placa(g, "KARAOKÊ", 1420, 310, "#ff2fd0", 28);
    });
    nova(0.55, (g) => {
      for (let x = 100; x < FAIXA - 120; x += 330 + rnd() * 120) {
        placa(g, ["BAR", "PIZZA", "CLUB", "24/7"][Math.floor(rnd() * 4)], x, 400 + rnd() * 40, ["#ff2fd0", "#4ff2ff", "#ffd23f"][Math.floor(rnd() * 3)], 24);
        g.fillStyle = "#07040f";
        g.fillRect(x - 3, 450, 6, 126);
      }
    });
  }

  // painel da bolsa (Wall Street) que passa correndo
  let painel: HTMLCanvasElement | null = null;
  if (tipo === "wall") {
    const [img, g] = tela(1500, 30);
    g.fillStyle = "rgba(0,0,0,0.88)";
    g.fillRect(0, 0, 1500, 30);
    let x = 20;
    for (const [txt, sobe] of [["OSMR ▲ 12,4%", true], ["COXA ▲ 8,1%", true], ["BRTA ▼ 3,7%", false], ["PIFE ▲ 2,2%", true], ["DRON ▼ 5,9%", false], ["TRCO ▲ 6,0%", true], ["CHNL ▲ 1,3%", true]] as [string, boolean][]) {
      g.font = "bold 17px ui-monospace, Consolas, monospace";
      g.textBaseline = "middle";
      g.shadowColor = g.fillStyle = sobe ? "#00ff9d" : "#ff4569";
      g.shadowBlur = 8;
      g.fillText(txt, x, 16);
      x += g.measureText(txt).width + 48;
    }
    painel = img;
  }

  const ceu: Record<Cenario, string[]> = {
    la: ["#1a0b3d", "#6b1d73", "#ff4f8b", "#ffae52"],
    wall: ["#02040f", "#07123a", "#17295e", "#2d3f7a"],
    neon: ["#05010f", "#160832", "#3a0f5c", "#6a1670"],
  };
  const gotas = Array.from({ length: 140 }, () => [rnd(), rnd(), 0.6 + rnd() * 0.8]);
  const estrelas = Array.from({ length: 70 }, () => [rnd(), rnd() * 0.45, rnd()]);

  return {
    desenhar(g, larg, alt, escala, camX, t) {
      const base = alt - ALTURA * escala; // o chão fica colado embaixo; o que sobra em cima é só céu
      const grad = g.createLinearGradient(0, 0, 0, alt);
      ceu[tipo].forEach((c, i, v) => grad.addColorStop(i / (v.length - 1), c));
      g.fillStyle = grad;
      g.fillRect(0, 0, larg, alt);
      for (const [x, y, f] of estrelas) {
        g.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(t * (0.5 + f) + f * 9));
        g.fillStyle = "#fff";
        g.fillRect(x * larg, y * alt, 2, 2);
      }
      g.globalAlpha = 1;
      if (tipo === "la") {
        // o sol listrado do fim de tarde
        const sx = larg * 0.68;
        const sy = base + 250 * escala;
        const r = 105 * escala;
        g.save();
        g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.clip();
        const sol = g.createLinearGradient(0, sy - r, 0, sy + r);
        sol.addColorStop(0, "#fff27a"); sol.addColorStop(0.55, "#ff8a3d"); sol.addColorStop(1, "#ff2f87");
        g.fillStyle = sol;
        let y = sy - r;
        let fresta = 0;
        while (y < sy + r) {
          const faixa = y < sy ? r : 14 * escala;
          g.fillRect(sx - r, y, r * 2, faixa);
          y += faixa + fresta;
          if (y >= sy) fresta = Math.min(9 * escala, fresta + 1.6 * escala);
        }
        g.restore();
      }
      camadas.forEach((c, n) => {
        const w = FAIXA * escala;
        let x = -((camX * c.paralaxe * escala) % w);
        for (; x < larg; x += w) g.drawImage(c.img, x, base, w + 1, ALTURA * escala);
        if (n === 1 && painel) {
          const pw = painel.width * escala;
          let px = -(((camX * c.paralaxe + t * 70) * escala) % pw);
          for (; px < larg; px += pw) g.drawImage(painel, px, base + 112 * escala, pw + 1, 30 * escala);
        }
      });
      if (tipo === "neon") {
        g.strokeStyle = "rgba(170,210,255,0.35)";
        g.lineWidth = Math.max(1, escala * 1.2);
        g.beginPath();
        for (const [x, y, v] of gotas) {
          const px = ((((x * 1.3 - t * 0.12 * v - camX * 0.0004) % 1) + 1) % 1) * larg;
          const py = ((y + t * 1.1 * v) % 1) * alt;
          g.moveTo(px, py);
          g.lineTo(px - 4 * escala, py + 18 * escala * v);
        }
        g.stroke();
      }
    },
  };
}
