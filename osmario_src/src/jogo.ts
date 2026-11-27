// O motor do jogo: física, colisões, inimigos, itens e regras. Não desenha nada nem lê teclado, então dá para testar
// sem navegador. Medidas em pixels do mundo (um bloco = T) e tempo em segundos.

import { LINHAS, TOTAL_FASES, montarFase, type Fase, type TipoInimigo } from "./fases.ts";

export const T = 48;
export const ALTURA_MUNDO = LINHAS * T;

const GRAVIDADE = 2300;
const FORCA_PULO = 920; // pulo de uns 3,8 blocos segurando o botão
const VEL_ANDAR = 240;
const VEL_CORRER = 390;
const ACEL_CHAO = 1500;
const ACEL_AR = 1100;
const ATRITO = 1900;
const QUEDA_MAX = 900;
const COIOTE = 0.1; // ainda dá para pular logo depois de sair da beirada
const BUFFER_PULO = 0.12; // apertar um pouco antes de tocar o chão também vale
export const TAMANHO = { pequeno: { w: 32, h: 70 }, grande: { w: 36, h: 90 } };
const VIDAS_INICIAIS = 3;
const SOLIDOS = new Set(["#", "B", "?", "C", "U", "=", "P"]);

export interface Controles { esquerda: boolean; direita: boolean; correr: boolean; pulo: boolean }
export type Evento = "pulo" | "moeda" | "pisao" | "coxinha" | "cresceu" | "bate" | "quebra" | "dano" | "morte" | "vitoria" | "vida";
export type Estado = "jogando" | "morrendo" | "venceuFase" | "fimDeJogo" | "zerou";

export interface Caixa { x: number; y: number; w: number; h: number }
export interface Heroi extends Caixa {
  vx: number; vy: number; noChao: boolean; direcao: 1 | -1; grande: boolean;
  invencivel: number; coiote: number; buffer: number; puloAntes: boolean; passos: number;
}
export interface Inimigo extends Caixa { tipo: TipoInimigo; vx: number; vy: number; baseX: number; baseY: number; t: number; achatado: number; ativo: boolean }
export interface Coxinha extends Caixa { vx: number; vy: number; saindo: number }
export interface Efeito { tipo: "moeda" | "pontos" | "caco"; x: number; y: number; vx: number; vy: number; t: number; texto?: string }

export const cruzam = (a: Caixa, b: Caixa): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export class Jogo {
  fase!: Fase;
  numero = 0;
  estado: Estado = "jogando";
  vidas = VIDAS_INICIAIS;
  moedas = 0;
  pontos = 0;
  tempo = 0;
  espera = 0; // tempo da animação atual (morte, vitória)
  h!: Heroi;
  inimigos: Inimigo[] = [];
  itens: Coxinha[] = [];
  efeitos: Efeito[] = [];
  batidos = new Map<string, number>(); // bloco "col,lin" -> tempo do pulinho
  private eventos: Evento[] = [];

  constructor(numero = 0) {
    this.carregar(numero);
  }

  // (re)começa uma fase, mantendo vidas, moedas e pontos
  carregar(numero: number): void {
    this.numero = numero;
    this.fase = montarFase(numero);
    const p = TAMANHO.pequeno;
    this.h = {
      x: this.fase.inicio * T, y: 10 * T - p.h, w: p.w, h: p.h, vx: 0, vy: 0, noChao: true, direcao: 1, grande: false,
      invencivel: 0, coiote: 0, buffer: 0, puloAntes: true, passos: 0,
    };
    this.inimigos = this.fase.inimigos.map((n) => {
      const voa = n.tipo === "drone";
      const w = voa ? 36 : 42;
      const h = voa ? 28 : 28;
      const x = n.col * T + (T - w) / 2;
      const y = voa ? n.lin * T : (n.lin + 1) * T - h;
      return { tipo: n.tipo, x, y, w, h, vx: voa ? -60 : -70, vy: 0, baseX: x, baseY: y, t: n.col, achatado: 0, ativo: false };
    });
    this.itens = [];
    this.efeitos = [];
    this.batidos.clear();
    this.estado = "jogando";
    this.espera = 0;
    this.tempo = 0;
  }

  novoJogo(numero = 0): void {
    this.vidas = VIDAS_INICIAIS;
    this.moedas = 0;
    this.pontos = 0;
    this.carregar(numero);
  }

  proximaFase(): void {
    if (this.estado === "venceuFase") this.carregar(this.numero + 1);
  }

  // ---------------- mapa ----------------

  bloco(col: number, lin: number): string {
    if (lin < 0 || lin >= LINHAS) return " ";
    if (col < 0 || col >= this.fase.largura) return "#"; // paredes nas pontas
    return this.fase.grade[lin][col];
  }

  private solido(col: number, lin: number): boolean {
    return SOLIDOS.has(this.bloco(col, lin));
  }

  // blocos sólidos que a caixa toca
  private tocados(c: Caixa): [number, number][] {
    const r: [number, number][] = [];
    for (let lin = Math.floor(c.y / T); lin <= Math.floor((c.y + c.h - 0.01) / T); lin++) {
      for (let col = Math.floor(c.x / T); col <= Math.floor((c.x + c.w - 0.01) / T); col++) if (this.solido(col, lin)) r.push([col, lin]);
    }
    return r;
  }

  // anda a caixa num eixo e encosta no primeiro bloco; devolve os blocos em que bateu
  private mover(c: Caixa, dx: number, dy: number): [number, number][] {
    c.x += dx;
    c.y += dy;
    const batidos = this.tocados(c);
    if (batidos.length === 0) return batidos;
    if (dx > 0) c.x = Math.min(...batidos.map(([col]) => col * T)) - c.w;
    else if (dx < 0) c.x = Math.max(...batidos.map(([col]) => (col + 1) * T));
    else if (dy > 0) c.y = Math.min(...batidos.map(([, lin]) => lin * T)) - c.h;
    else if (dy < 0) c.y = Math.max(...batidos.map(([, lin]) => (lin + 1) * T));
    return batidos;
  }

  // ---------------- passo do jogo ----------------

  passo(dt: number, c: Controles): Evento[] {
    this.eventos = [];
    this.animarEfeitos(dt);
    if (this.estado === "morrendo") this.morrer(dt);
    else if (this.estado === "jogando") {
      this.tempo += dt;
      this.moverHeroi(dt, c);
      if ((this.estado as Estado) === "jogando") {
        this.moverInimigos(dt);
        this.moverItens(dt);
      }
    }
    this.h.puloAntes = c.pulo;
    return this.eventos;
  }

  private moverHeroi(dt: number, c: Controles): void {
    const h = this.h;
    h.invencivel = Math.max(0, h.invencivel - dt);

    // andar / correr
    const lado = (c.direita ? 1 : 0) - (c.esquerda ? 1 : 0);
    if (lado !== 0) {
      h.direcao = lado as 1 | -1;
      const alvo = lado * (c.correr ? VEL_CORRER : VEL_ANDAR);
      const acel = (h.noChao ? ACEL_CHAO : ACEL_AR) * (h.vx * lado < 0 ? 1.8 : 1); // virar é mais rápido
      h.vx = h.vx < alvo ? Math.min(alvo, h.vx + acel * dt) : Math.max(alvo, h.vx - acel * dt);
    } else if (h.noChao) {
      h.vx = Math.sign(h.vx) * Math.max(0, Math.abs(h.vx) - ATRITO * dt);
    }

    // pulo
    h.buffer = c.pulo && !h.puloAntes ? BUFFER_PULO : Math.max(0, h.buffer - dt);
    h.coiote = h.noChao ? COIOTE : Math.max(0, h.coiote - dt);
    if (h.buffer > 0 && h.coiote > 0) {
      h.vy = -FORCA_PULO * (Math.abs(h.vx) > VEL_ANDAR + 40 ? 1.05 : 1);
      h.buffer = 0;
      h.coiote = 0;
      h.noChao = false;
      this.eventos.push("pulo");
    }
    // soltar o botão cedo faz um pulo baixo
    h.vy = Math.min(QUEDA_MAX, h.vy + GRAVIDADE * (h.vy < 0 && !c.pulo ? 2.4 : 1) * dt);

    if (this.mover(h, h.vx * dt, 0).length) h.vx = 0;
    const vyAntes = h.vy;
    const bateu = this.mover(h, 0, h.vy * dt);
    h.noChao = false;
    if (bateu.length) {
      if (vyAntes > 0) h.noChao = true;
      else {
        // cabeçada: vale o bloco mais perto do meio do herói
        const meio = h.x + h.w / 2;
        bateu.sort((a, b) => Math.abs((a[0] + 0.5) * T - meio) - Math.abs((b[0] + 0.5) * T - meio));
        this.cabecada(bateu[0][0], bateu[0][1]);
      }
      h.vy = 0;
    }
    h.passos += Math.abs(h.vx) * dt;

    this.pegarMoedas();
    if (h.y > ALTURA_MUNDO + 20) { this.comecarMorte(false); return; }
    if (h.x + h.w / 2 >= (this.fase.chegada + 0.5) * T) {
      this.pontos += 1000 + Math.max(0, Math.round(200 - this.tempo)) * 10; // bônus por ser rápido
      this.estado = this.numero + 1 >= TOTAL_FASES ? "zerou" : "venceuFase";
      this.eventos.push("vitoria");
    }
  }

  private ganharMoeda(): void {
    this.moedas++;
    this.pontos += 100;
    this.eventos.push("moeda");
    if (this.moedas % 50 === 0) { this.vidas++; this.eventos.push("vida"); }
  }

  private pegarMoedas(): void {
    const h = this.h;
    for (let lin = Math.floor(h.y / T); lin <= Math.floor((h.y + h.h) / T); lin++) {
      for (let col = Math.floor(h.x / T); col <= Math.floor((h.x + h.w) / T); col++) {
        if (this.bloco(col, lin) !== "o") continue;
        if (!cruzam(h, { x: col * T + 10, y: lin * T + 6, w: T - 20, h: T - 12 })) continue;
        this.fase.grade[lin][col] = " ";
        this.ganharMoeda();
      }
    }
  }

  private cabecada(col: number, lin: number): void {
    const b = this.bloco(col, lin);
    if (b !== "?" && b !== "C" && b !== "B") { this.eventos.push("bate"); return; }
    this.batidos.set(`${col},${lin}`, 0.18);
    // quem estiver em cima do bloco leva o tranco
    for (const i of this.inimigos) if (!i.achatado && cruzam(i, { x: col * T, y: lin * T - 6, w: T, h: 8 })) this.derrubarInimigo(i);
    if (b === "?") {
      this.fase.grade[lin][col] = "U";
      this.efeitos.push({ tipo: "moeda", x: (col + 0.5) * T, y: lin * T, vx: 0, vy: -520, t: 0.5 });
      this.ganharMoeda();
    } else if (b === "C") {
      this.fase.grade[lin][col] = "U";
      this.itens.push({ x: col * T + 7, y: lin * T, w: 34, h: 34, vx: 90, vy: 0, saindo: 0.5 });
      this.eventos.push("coxinha");
    } else if (this.h.grande) {
      this.fase.grade[lin][col] = " ";
      this.pontos += 50;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 0], [1, 0]]) {
        this.efeitos.push({ tipo: "caco", x: (col + 0.5 + dx * 0.2) * T, y: (lin + 0.5 + dy * 0.2) * T, vx: dx * 140, vy: -420 + dy * 160, t: 0.9 });
      }
      this.eventos.push("quebra");
    } else this.eventos.push("bate");
  }

  private derrubarInimigo(i: Inimigo): void {
    i.achatado = 0.4;
    this.pontos += 200;
    this.efeitos.push({ tipo: "pontos", x: i.x + i.w / 2, y: i.y, vx: 0, vy: -60, t: 0.8, texto: "200" });
    this.eventos.push("pisao");
  }

  private moverInimigos(dt: number): void {
    const h = this.h;
    for (let k = this.inimigos.length - 1; k >= 0; k--) {
      const i = this.inimigos[k];
      if (i.achatado > 0) {
        i.achatado -= dt;
        if (i.achatado <= 0) this.inimigos.splice(k, 1);
        continue;
      }
      if (!i.ativo) { if (Math.abs(i.x - h.x) < 14 * T) i.ativo = true; else continue; } // só anda quando chega perto
      i.t += dt;
      if (i.tipo === "drone") {
        i.x += i.vx * dt;
        if (Math.abs(i.x - i.baseX) > 2.5 * T) { i.vx = -i.vx; i.x = i.baseX + Math.sign(i.x - i.baseX) * 2.5 * T; }
        i.y = i.baseY + Math.sin(i.t * 2.6) * 46;
      } else {
        if (this.mover(i, i.vx * dt, 0).length) i.vx = -i.vx;
        i.vy = Math.min(QUEDA_MAX, i.vy + GRAVIDADE * dt);
        if (this.mover(i, 0, i.vy * dt).length) {
          i.vy = 0;
          // barata não se joga da beirada: vira antes
          const frente = i.vx > 0 ? i.x + i.w + 2 : i.x - 2;
          if (!this.solido(Math.floor(frente / T), Math.floor((i.y + i.h + 4) / T))) i.vx = -i.vx;
        }
        if (i.y > ALTURA_MUNDO + 40) { this.inimigos.splice(k, 1); continue; }
      }
      if (!cruzam(h, i)) continue;
      // caindo em cima = pisão; de lado ou por baixo = dano
      if (h.vy > 0 && h.y + h.h - i.y < 22) {
        this.derrubarInimigo(i);
        h.vy = h.puloAntes ? -760 : -480;
        h.y = i.y - h.h;
        h.noChao = false;
      } else if (h.invencivel === 0) this.dano();
    }
  }

  private moverItens(dt: number): void {
    for (let k = this.itens.length - 1; k >= 0; k--) {
      const c = this.itens[k];
      if (c.saindo > 0) {
        c.saindo -= dt;
        c.y -= (c.h / 0.5) * dt; // sobe de dentro do bloco
      } else {
        if (this.mover(c, c.vx * dt, 0).length) c.vx = -c.vx;
        c.vy = Math.min(QUEDA_MAX, c.vy + GRAVIDADE * 0.6 * dt);
        if (this.mover(c, 0, c.vy * dt).length) c.vy = 0;
        if (c.y > ALTURA_MUNDO) { this.itens.splice(k, 1); continue; }
      }
      if (!cruzam(this.h, c)) continue;
      this.itens.splice(k, 1);
      this.pontos += 500;
      this.efeitos.push({ tipo: "pontos", x: c.x + c.w / 2, y: c.y, vx: 0, vy: -60, t: 0.8, texto: "500" });
      this.mudarTamanho(true);
      this.eventos.push("cresceu");
    }
  }

  // muda de tamanho mantendo os pés no lugar
  private mudarTamanho(grande: boolean): void {
    const h = this.h;
    if (h.grande === grande) return;
    const novo = grande ? TAMANHO.grande : TAMANHO.pequeno;
    h.y += h.h - novo.h;
    h.x += (h.w - novo.w) / 2;
    h.w = novo.w;
    h.h = novo.h;
    h.grande = grande;
    // se a cabeça entrou num bloco ou o ombro numa parede, desencosta
    for (const [col, lin] of this.tocados(h)) {
      if ((lin + 1) * T <= h.y + h.h / 2) h.y = Math.max(h.y, (lin + 1) * T);
      else if ((col + 0.5) * T > h.x + h.w / 2) h.x = Math.min(h.x, col * T - h.w);
      else h.x = Math.max(h.x, (col + 1) * T);
    }
  }

  private dano(): void {
    if (this.h.grande) {
      this.mudarTamanho(false);
      this.h.invencivel = 1.6;
      this.eventos.push("dano");
    } else this.comecarMorte(true);
  }

  private comecarMorte(pulinho: boolean): void {
    this.estado = "morrendo";
    this.espera = 1.6;
    this.h.vx = 0;
    this.h.vy = pulinho ? -700 : 0;
    this.eventos.push("morte");
  }

  private morrer(dt: number): void {
    this.h.vy += GRAVIDADE * 0.7 * dt;
    this.h.y += this.h.vy * dt;
    this.espera -= dt;
    if (this.espera > 0) return;
    this.vidas--;
    if (this.vidas <= 0) this.estado = "fimDeJogo";
    else this.carregar(this.numero);
  }

  private animarEfeitos(dt: number): void {
    for (let k = this.efeitos.length - 1; k >= 0; k--) {
      const e = this.efeitos[k];
      e.t -= dt;
      if (e.tipo !== "pontos") e.vy += GRAVIDADE * 0.7 * dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.t <= 0) this.efeitos.splice(k, 1);
    }
    for (const [k, t] of this.batidos) {
      if (t - dt <= 0) this.batidos.delete(k);
      else this.batidos.set(k, t - dt);
    }
  }
}
