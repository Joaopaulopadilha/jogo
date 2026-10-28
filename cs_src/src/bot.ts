// bot.ts
// Adversário controlado pelo computador (modo solo). Gera um Cmd por frame, como um jogador de verdade;
// quem aplica o comando (e valida tudo) é o HostGame.

import { ALTURA, ALTURA_AGACHADO, ARMAS, OLHO, SLOT_GRANADA, moverCorpo } from "./shared";
import type { HostGame, Jogador } from "./hostgame";
import type { Cmd } from "./types";

export type Dificuldade = "facil" | "normal" | "dificil";

interface Perfil {
  reacao: number;          // s entre ver o alvo e começar a atirar
  giro: number;            // rad/s da mira
  erro: number;            // m de erro de mira no alvo
  rajada: [number, number]; // duração do tiro contínuo (s)
  pausa: [number, number];  // intervalo entre rajadas (s)
  granada: number;         // chance por segundo de jogar granada quando possível
}

const PERFIS: Record<Dificuldade, Perfil> = {
  facil: { reacao: 0.9, giro: 2.2, erro: 0.6, rajada: [0.15, 0.3], pausa: [0.5, 1.0], granada: 0.15 },
  normal: { reacao: 0.5, giro: 3.6, erro: 0.35, rajada: [0.25, 0.5], pausa: [0.3, 0.7], granada: 0.35 },
  dificil: { reacao: 0.25, giro: 6, erro: 0.15, rajada: [0.4, 0.8], pausa: [0.15, 0.4], granada: 0.6 },
};

const aleatorio = (a: number, b: number): number => a + Math.random() * (b - a);

function normalizarAngulo(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function aproximar(atual: number, alvo: number, passo: number): number {
  const d = normalizarAngulo(alvo - atual);
  return atual + Math.max(-passo, Math.min(passo, d));
}

export class Bot {
  private perfil: Perfil;
  private seq = 0;
  private rodada = -1;

  private yaw = 0;
  private pitch = 0;

  private alvoId = -1;
  private tAlvo = 0;
  private tVisao = 0;
  private visivel = false;
  private vistoHa = 0;
  private ultimaPos: [number, number, number] = [0, 0, 0];

  private erro: [number, number, number] = [0, 0, 0];
  private tErro = 0;

  private emRajada = false;
  private tRajada = 0;
  private ultimoFire = false;

  private estrafe = 1;
  private tEstrafe = 0;

  private rumo = 0;
  private tRumo = 0;
  private desvio = 0; // s restantes seguindo um rumo aleatório (destravando)
  private tTravado = 0;
  private posAmostra: [number, number] = [0, 0];
  private pular = 0;

  private granadaTempo = 0; // >0: preparando o arremesso

  constructor(public id: number, public dificuldade: Dificuldade) {
    this.perfil = PERFIS[dificuldade];
  }

  private parado(dt: number, eu: Jogador): Cmd {
    return {
      seq: ++this.seq, dt, fwd: 0, strafe: 0, jump: false,
      yaw: this.yaw, pitch: this.pitch, fire: false, reload: false, arma: eu.arma,
    };
  }

  private novaRodada(eu: Jogador, rodada: number): void {
    this.rodada = rodada;
    this.yaw = eu.yaw;
    this.pitch = 0;
    this.alvoId = -1;
    this.tAlvo = 0;
    this.visivel = false;
    this.vistoHa = 0;
    this.emRajada = false;
    this.tRajada = aleatorio(0, 0.5);
    this.granadaTempo = 0;
    this.desvio = 0;
    this.tTravado = 0;
    this.posAmostra = [eu.x, eu.z];
  }

  // melhor direção (ângulo no mundo) para chegar em (gx, gz), testando a física real em vários rumos
  private escolherRumo(eu: Jogador, gx: number, gz: number): number {
    const direto = Math.atan2(-(gx - eu.x), -(gz - eu.z));
    let melhor = direto;
    let melhorNota = Infinity;
    for (const desvio of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
      const ang = direto + desvio;
      const c = { x: eu.x, y: eu.y, z: eu.z, vy: eu.vy };
      for (let i = 0; i < 4; i++) moverCorpo(c, { dt: 0.1, fwd: 1, strafe: 0, jump: false, yaw: ang });
      const nota = Math.hypot(gx - c.x, gz - c.z) + Math.abs(desvio) * 0.4;
      if (nota < melhorNota) { melhorNota = nota; melhor = ang; }
    }
    return melhor;
  }

  pensar(dt: number, jogo: HostGame): Cmd {
    const eu = jogo.jogadores[this.id];
    if (jogo.rodada !== this.rodada) this.novaRodada(eu, jogo.rodada);
    if (!eu.vivo || jogo.fase === "warmup" || jogo.fase === "matchEnd") return this.parado(dt, eu);

    // ---- alvo: o inimigo vivo mais próximo ----
    this.tAlvo -= dt;
    if (this.tAlvo <= 0) {
      this.tAlvo = 0.4;
      let melhor = -1;
      let menor = Infinity;
      for (const q of jogo.jogadores) {
        if (q.id === this.id || !q.conectado || !q.vivo) continue;
        const d = Math.hypot(q.x - eu.x, q.z - eu.z);
        if (d < menor) { menor = d; melhor = q.id; }
      }
      this.alvoId = melhor;
    }
    const alvo = this.alvoId >= 0 ? jogo.jogadores[this.alvoId] : null;
    if (!alvo || !alvo.vivo) return this.parado(dt, eu);

    // ---- visão ----
    this.tVisao -= dt;
    if (this.tVisao <= 0) {
      this.tVisao = 0.1;
      this.visivel = jogo.temVisao(eu, alvo);
    }
    if (this.visivel) {
      this.vistoHa += dt;
      this.ultimaPos = [alvo.x, alvo.y - (alvo.ag ? ALTURA - ALTURA_AGACHADO : 0), alvo.z];
    } else {
      this.vistoHa = 0;
    }

    const dx = this.ultimaPos[0] - eu.x;
    const dz = this.ultimaPos[2] - eu.z;
    const dist = Math.hypot(dx, dz);

    // ---- mira ----
    this.tErro -= dt;
    if (this.tErro <= 0) {
      this.tErro = 0.35;
      const e = this.perfil.erro;
      this.erro = [aleatorio(-e, e), aleatorio(-e * 0.5, e * 0.5), aleatorio(-e, e)];
    }
    const reducao = Math.max(0.4, 1 - this.vistoHa * 0.3);
    const ax = this.ultimaPos[0] + this.erro[0] * reducao - eu.x;
    const ay = this.ultimaPos[1] + 1.3 + this.erro[1] * reducao - (eu.y + OLHO);
    const az = this.ultimaPos[2] + this.erro[2] * reducao - eu.z;
    const yawAlvo = Math.atan2(-ax, -az);
    const pitchAlvo = Math.atan2(ay, Math.hypot(ax, az));

    // ---- movimento ----
    let fwd = 0;
    let strafe = 0;
    let pular = false;

    if (this.visivel) {
      this.tEstrafe -= dt;
      if (this.tEstrafe <= 0) {
        this.tEstrafe = aleatorio(0.5, 1.3);
        this.estrafe = Math.random() < 0.5 ? -1 : 1;
      }
      strafe = this.estrafe * 0.8;
      if (dist > 14) fwd = 1;
      else if (dist < 5) fwd = -1;
    }

    // navegação: segue o alvo quando não o vê ou quando está longe
    const navegar = !this.visivel || dist > 14;
    this.tRumo -= dt;
    this.desvio = Math.max(0, this.desvio - dt);
    if (navegar && this.tRumo <= 0) {
      this.tRumo = 0.25;
      if (this.desvio <= 0) this.rumo = this.escolherRumo(eu, this.ultimaPos[0], this.ultimaPos[2]);
    }

    // detecta travamento (andou pouco tentando se mover)
    this.tTravado += dt;
    if (this.tTravado >= 0.5) {
      const andou = Math.hypot(eu.x - this.posAmostra[0], eu.z - this.posAmostra[1]);
      this.posAmostra = [eu.x, eu.z];
      this.tTravado = 0;
      if (andou < 0.4 && (navegar || this.visivel)) {
        this.pular = 0.5;
        this.estrafe = -this.estrafe;
        if (navegar) { this.desvio = 0.8; this.rumo += aleatorio(-2, 2); }
      }
    }
    if (this.pular > 0) { this.pular -= dt; pular = true; }

    if (navegar) {
      // converte o rumo do mundo para fwd/strafe relativos ao olhar
      fwd = Math.cos(this.rumo - this.yaw);
      strafe = Math.sin(this.yaw - this.rumo);
    }

    // ---- granada ----
    const temGranada = eu.granadas > 0;
    if (this.granadaTempo > 0) {
      this.granadaTempo -= dt;
    } else if (temGranada && this.visivel && dist > 6 && dist < 16 && this.vistoHa > 0.5
      && Math.random() < this.perfil.granada * dt) {
      this.granadaTempo = 0.6;
    }
    const lancando = this.granadaTempo > 0;

    // ---- giro da mira ----
    const passo = this.perfil.giro * dt;
    if (this.visivel || lancando) {
      this.yaw = aproximar(this.yaw, yawAlvo, passo);
      this.pitch = aproximar(this.pitch, pitchAlvo + (lancando ? 0.28 : 0), passo);
    } else {
      this.yaw = aproximar(this.yaw, this.rumo, passo);
      this.pitch = aproximar(this.pitch, 0, passo);
    }

    // ---- armas ----
    let arma = 0;
    if (eu.municao[0] === 0 && eu.municao[1] > 0) arma = 1;
    if (lancando) arma = SLOT_GRANADA;

    let fire = false;
    let reload = false;

    if (lancando) {
      // solta o botão e só clica no fim da preparação (o host exige clique novo)
      fire = this.granadaTempo < 0.1 && this.granadaTempo > 0;
    } else if (this.visivel && this.vistoHa > this.perfil.reacao) {
      const erroAng = Math.abs(normalizarAngulo(this.yaw - yawAlvo)) + Math.abs(this.pitch - pitchAlvo);
      const alinhado = erroAng < 0.07 + 0.5 / Math.max(dist, 4);

      this.tRajada -= dt;
      if (this.tRajada <= 0) {
        this.emRajada = !this.emRajada;
        this.tRajada = this.emRajada
          ? aleatorio(...this.perfil.rajada)
          : aleatorio(...this.perfil.pausa);
      }
      if (this.emRajada && alinhado) {
        // arma semi-automática: alterna o botão a cada frame para gerar cliques
        fire = ARMAS[arma].auto ? true : !this.ultimoFire;
      }
    } else {
      this.emRajada = false;
      // recarrega quando está seguro e com pouca munição
      const pente = ARMAS[arma].pente;
      if (!this.visivel && eu.municao[arma] < pente * 0.5 && eu.recarga === 0) reload = true;
    }
    this.ultimoFire = fire;

    return {
      seq: ++this.seq, dt, fwd, strafe, jump: pular, yaw: this.yaw, pitch: this.pitch,
      fire, reload, arma,
    };
  }
}
