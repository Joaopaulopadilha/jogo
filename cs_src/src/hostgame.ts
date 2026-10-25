// hostgame.ts
// Lógica autoritativa da partida (roda só no host): rounds, tiros, granadas, vida, placar.

import {
  ALCANCE, ALTURA, AQUECIMENTO, ARMAS, CAIXAS, EXPLOSAO_DANO, EXPLOSAO_RAIO, FIM_ROUND,
  GRANADAS_POR_ROUND, GRANADA_FUSIVEL, GRANADA_RAIO, GRANADA_VELOCIDADE, GRAVIDADE, MAX_DT, OLHO,
  ROUNDS_PARA_VENCER, SLOT_GRANADA, SPAWNS, TEMPO_ROUND, VIDA,
  direcao, moverCorpo, raioCaixa,
} from "./shared";
import type { Arma, Corpo } from "./shared";
import type {
  BoomMsg, Cmd, KillMsg, Phase, PlayerInfo, PlayerSnap, ShotMsg, Snapshot, Vec3,
} from "./types";

export interface Jogador extends Corpo {
  id: number;
  yaw: number;
  pitch: number;
  hp: number;
  vivo: boolean;
  conectado: boolean;
  arma: number;
  municao: number[];
  granadas: number;
  recarga: number;
  espera: number;
  cliqueAnterior: boolean;
  ack: number;
  vitorias: number;
  abates: number;
  mortes: number;
}

interface Granada {
  id: number;
  dono: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fusivel: number;
}

const META_HEAD = 1.45; // acima disso (a partir dos pés) conta como headshot
const LARGURA_HITBOX = 0.35;
const LIMITE_ARENA = 19.6;
const TROCA_ARMA = 0.35; // s de espera ao trocar de arma

export class HostGame {
  jogadores: Jogador[];
  granadas: Granada[] = [];
  fase: Phase = "warmup";
  tempo = AQUECIMENTO;
  rodada = 0;
  vencedor = -1;
  private proximaGranada = 1;

  onShot: (m: ShotMsg) => void = () => {};
  onKill: (m: KillMsg) => void = () => {};
  onBoom: (m: BoomMsg) => void = () => {};

  constructor(infos: PlayerInfo[]) {
    this.jogadores = infos.map((i) => ({
      id: i.id, x: 0, y: 0, z: 0, vy: 0, yaw: 0, pitch: 0,
      hp: VIDA, vivo: true, conectado: true, arma: 0,
      municao: ARMAS.map((a) => a.pente), granadas: GRANADAS_POR_ROUND,
      recarga: 0, espera: 0, cliqueAnterior: false,
      ack: 0, vitorias: 0, abates: 0, mortes: 0,
    }));
    this.iniciarRodada();
  }

  // continua uma partida a partir da última foto recebida (troca de host); "ausentes" são os jogadores que saíram
  static restaurar(infos: PlayerInfo[], s: Snapshot, ausentes: number[]): HostGame {
    const g = new HostGame(infos);
    g.fase = s.phase;
    g.tempo = s.timer;
    g.rodada = s.round;
    g.vencedor = s.winner;
    for (const q of s.ps) {
      const p = g.jogadores[q.id];
      if (!p) continue;
      p.x = q.x; p.y = q.y; p.z = q.z; p.vy = q.vy; p.yaw = q.yaw; p.pitch = q.pitch;
      p.hp = q.hp; p.vivo = q.alive; p.conectado = q.on;
      p.arma = q.arma; p.municao = [...q.am]; p.granadas = q.gr;
      p.recarga = q.reloading && q.arma < SLOT_GRANADA ? ARMAS[q.arma].recarga : 0;
      p.ack = q.ack; p.vitorias = q.wins; p.abates = q.kills; p.mortes = q.deaths;
    }
    for (const id of ausentes) g.desconectar(id);
    return g; // granadas no ar se perdem na troca
  }

  reiniciarPartida(): void {
    for (const p of this.jogadores) {
      p.vitorias = 0; p.abates = 0; p.mortes = 0;
    }
    this.rodada = 0;
    this.iniciarRodada();
  }

  private iniciarRodada(): void {
    this.rodada++;
    this.fase = "warmup";
    this.tempo = AQUECIMENTO;
    this.vencedor = -1;
    this.granadas = [];
    for (const p of this.jogadores) {
      const s = SPAWNS[p.id];
      p.x = s.x; p.y = 0; p.z = s.z; p.vy = 0;
      p.yaw = s.yaw; p.pitch = 0;
      p.hp = VIDA;
      p.vivo = p.conectado;
      p.arma = 0;
      p.municao = ARMAS.map((a) => a.pente);
      p.granadas = GRANADAS_POR_ROUND;
      p.recarga = 0;
      p.espera = 0;
    }
  }

  desconectar(id: number): void {
    const p = this.jogadores[id];
    if (!p) return;
    p.conectado = false;
    p.vivo = false;
  }

  aplicarComando(id: number, c: Cmd): void {
    const p = this.jogadores[id];
    if (!p || !p.conectado) return;
    const dt = Math.min(Math.max(c.dt, 0), MAX_DT);
    p.ack = c.seq;
    p.yaw = c.yaw;
    p.pitch = Math.max(-1.55, Math.min(1.55, c.pitch));
    const clique = c.fire && !p.cliqueAnterior;
    p.cliqueAnterior = c.fire;
    if (!p.vivo) return;

    if (this.fase !== "warmup") moverCorpo(p, { ...c, dt });

    p.espera = Math.max(0, p.espera - dt);

    // troca de arma
    const pedida = c.arma;
    if (pedida !== p.arma && Number.isInteger(pedida) && pedida >= 0 && pedida <= SLOT_GRANADA
        && (pedida !== SLOT_GRANADA || p.granadas > 0)) {
      p.arma = pedida;
      p.recarga = 0;
      p.espera = Math.max(p.espera, TROCA_ARMA);
    }

    const arma = p.arma < SLOT_GRANADA ? ARMAS[p.arma] : null;

    if (arma && p.recarga > 0) {
      p.recarga -= dt;
      if (p.recarga <= 0) { p.recarga = 0; p.municao[p.arma] = arma.pente; }
    }
    if (arma && c.reload && p.recarga === 0 && p.municao[p.arma] < arma.pente && this.fase === "live") {
      p.recarga = arma.recarga;
    }

    if (this.fase !== "live" || p.espera > 0 || p.recarga > 0) return;

    if (!arma) {
      if (clique && p.granadas > 0) this.lancar(p);
      return;
    }
    if (arma.auto ? c.fire : clique) {
      if (p.municao[p.arma] > 0) this.atirar(p, arma);
      else if (p.municao[p.arma] < arma.pente) p.recarga = arma.recarga;
    }
  }

  // linha de visão livre entre os olhos de a e o peito de b
  temVisao(a: Jogador, b: Jogador): boolean {
    const o: Vec3 = [a.x, a.y + OLHO, a.z];
    const v: Vec3 = [b.x - o[0], b.y + 1.2 - o[1], b.z - o[2]];
    const dist = Math.hypot(v[0], v[1], v[2]);
    if (dist < 1e-6) return true;
    const d: Vec3 = [v[0] / dist, v[1] / dist, v[2] / dist];
    return !CAIXAS.some((c) => {
      const t = raioCaixa(o, d, [c.x - c.w / 2, 0, c.z - c.d / 2], [c.x + c.w / 2, c.h, c.z + c.d / 2]);
      return t !== null && t < dist;
    });
  }

  private atirar(p: Jogador, arma: Arma): void {
    p.municao[p.arma]--;
    p.espera = arma.intervalo;

    const o: Vec3 = [p.x, p.y + OLHO, p.z];
    const d = direcao(
      p.yaw + (Math.random() - 0.5) * arma.dispersao,
      p.pitch + (Math.random() - 0.5) * arma.dispersao,
    );

    let melhor = ALCANCE;
    let alvo = -1;

    for (const c of CAIXAS) {
      const t = raioCaixa(o, d, [c.x - c.w / 2, 0, c.z - c.d / 2], [c.x + c.w / 2, c.h, c.z + c.d / 2]);
      if (t !== null && t < melhor) melhor = t;
    }
    if (d[1] < 0) {
      const t = -o[1] / d[1];
      if (t < melhor) melhor = t;
    }
    for (const q of this.jogadores) {
      if (q === p || !q.conectado || !q.vivo) continue;
      const t = raioCaixa(
        o, d,
        [q.x - LARGURA_HITBOX, q.y, q.z - LARGURA_HITBOX],
        [q.x + LARGURA_HITBOX, q.y + ALTURA, q.z + LARGURA_HITBOX],
      );
      if (t !== null && t < melhor) { melhor = t; alvo = q.id; }
    }

    const e: Vec3 = [o[0] + d[0] * melhor, o[1] + d[1] * melhor, o[2] + d[2] * melhor];
    let head = false;
    if (alvo >= 0) {
      const q = this.jogadores[alvo];
      head = e[1] - q.y > META_HEAD;
      this.causarDano(q, head ? arma.dano * 2 : arma.dano, p, p.arma, head);
    }
    this.onShot({ t: "shot", i: p.id, w: p.arma, o, e, h: alvo, hs: head });
  }

  private causarDano(alvo: Jogador, dano: number, autor: Jogador, arma: number, head: boolean): void {
    if (!alvo.vivo) return;
    alvo.hp -= dano;
    if (alvo.hp > 0) return;
    alvo.hp = 0;
    alvo.vivo = false;
    alvo.mortes++;
    if (autor !== alvo) autor.abates++;
    this.onKill({ t: "kill", killer: autor.id, victim: alvo.id, w: arma, head });
  }

  // ---- Granadas ----

  private lancar(p: Jogador): void {
    const d = direcao(p.yaw, p.pitch);
    p.granadas--;
    p.arma = 0;
    p.espera = TROCA_ARMA;
    this.granadas.push({
      id: this.proximaGranada++,
      dono: p.id,
      x: p.x + d[0] * 0.5,
      y: p.y + OLHO + d[1] * 0.5,
      z: p.z + d[2] * 0.5,
      vx: d[0] * GRANADA_VELOCIDADE,
      vy: d[1] * GRANADA_VELOCIDADE + 3,
      vz: d[2] * GRANADA_VELOCIDADE,
      fusivel: GRANADA_FUSIVEL,
    });
  }

  private batendo(g: Granada): boolean {
    for (const c of CAIXAS) {
      if (
        g.y - GRANADA_RAIO < c.h - 0.02 &&
        Math.abs(g.x - c.x) < c.w / 2 + GRANADA_RAIO &&
        Math.abs(g.z - c.z) < c.d / 2 + GRANADA_RAIO
      ) return true;
    }
    return false;
  }

  private passoGranada(g: Granada, h: number): void {
    g.vy -= GRAVIDADE * h;

    g.x += g.vx * h;
    if (this.batendo(g) || Math.abs(g.x) > LIMITE_ARENA) {
      g.x -= g.vx * h;
      g.vx *= -0.45; g.vz *= 0.85;
    }
    g.z += g.vz * h;
    if (this.batendo(g) || Math.abs(g.z) > LIMITE_ARENA) {
      g.z -= g.vz * h;
      g.vz *= -0.45; g.vx *= 0.85;
    }

    g.y += g.vy * h;
    let chao = 0;
    for (const c of CAIXAS) {
      if (
        c.h <= g.y - GRANADA_RAIO + 0.15 &&
        Math.abs(g.x - c.x) < c.w / 2 + GRANADA_RAIO &&
        Math.abs(g.z - c.z) < c.d / 2 + GRANADA_RAIO &&
        c.h > chao
      ) chao = c.h;
    }
    if (g.y - GRANADA_RAIO < chao) {
      g.y = chao + GRANADA_RAIO;
      g.vy = g.vy < -1.5 ? -g.vy * 0.4 : 0;
      const atrito = Math.max(0, 1 - 5 * h);
      g.vx *= atrito;
      g.vz *= atrito;
    }
  }

  private atualizarGranadas(dt: number): void {
    for (const g of this.granadas) {
      let resto = dt;
      while (resto > 1e-6) {
        const h = Math.min(resto, 1 / 120);
        resto -= h;
        this.passoGranada(g, h);
      }
      g.fusivel -= dt;
    }
    const prontas = this.granadas.filter((g) => g.fusivel <= 0);
    if (prontas.length === 0) return;
    this.granadas = this.granadas.filter((g) => g.fusivel > 0);
    for (const g of prontas) this.explodir(g);
  }

  private explodir(g: Granada): void {
    const centro: Vec3 = [g.x, g.y + 0.2, g.z];
    const autor = this.jogadores[g.dono];

    for (const q of this.jogadores) {
      if (!q.conectado || !q.vivo) continue;
      const alvo: Vec3 = [q.x, q.y + ALTURA / 2, q.z];
      const v: Vec3 = [alvo[0] - centro[0], alvo[1] - centro[1], alvo[2] - centro[2]];
      const dist = Math.hypot(v[0], v[1], v[2]);
      if (dist > EXPLOSAO_RAIO) continue;

      const dir: Vec3 = dist > 1e-6 ? [v[0] / dist, v[1] / dist, v[2] / dist] : [0, 1, 0];
      const bloqueado = CAIXAS.some((c) => {
        const t = raioCaixa(centro, dir, [c.x - c.w / 2, 0, c.z - c.d / 2], [c.x + c.w / 2, c.h, c.z + c.d / 2]);
        return t !== null && t < dist - 0.4;
      });
      if (bloqueado) continue;

      this.causarDano(q, EXPLOSAO_DANO * (1 - dist / EXPLOSAO_RAIO), autor, SLOT_GRANADA, false);
    }
    this.onBoom({ t: "boom", x: g.x, y: g.y, z: g.z });
  }

  // ---- Fases ----

  atualizar(dt: number): void {
    this.tempo -= dt;
    this.atualizarGranadas(dt);
    const on = this.jogadores.filter((p) => p.conectado);

    switch (this.fase) {
      case "warmup":
        if (this.tempo <= 0) { this.fase = "live"; this.tempo = TEMPO_ROUND; }
        break;
      case "live": {
        const vivos = on.filter((p) => p.vivo);
        if (on.length < 2) this.fimDaPartida(on[0]?.id ?? -1);
        else if (vivos.length <= 1) this.fimDaRodada(vivos[0]?.id ?? -2);
        else if (this.tempo <= 0) this.fimDaRodada(-2);
        break;
      }
      case "roundEnd":
        if (this.tempo <= 0) this.iniciarRodada();
        break;
      case "matchEnd":
        break;
    }
  }

  private fimDaRodada(vencedor: number): void {
    this.vencedor = vencedor;
    if (vencedor >= 0) {
      const w = this.jogadores[vencedor];
      w.vitorias++;
      if (w.vitorias >= ROUNDS_PARA_VENCER) {
        this.fimDaPartida(vencedor);
        return;
      }
    }
    this.fase = "roundEnd";
    this.tempo = FIM_ROUND;
  }

  private fimDaPartida(vencedor: number): void {
    this.fase = "matchEnd";
    this.vencedor = vencedor;
    this.tempo = 0;
  }

  snapshot(): Snapshot {
    return {
      phase: this.fase,
      timer: Math.max(0, this.tempo),
      round: this.rodada,
      winner: this.vencedor,
      ps: this.jogadores.map((p): PlayerSnap => ({
        id: p.id, x: p.x, y: p.y, z: p.z, vy: p.vy, yaw: p.yaw, pitch: p.pitch,
        hp: p.hp, alive: p.vivo, on: p.conectado,
        arma: p.arma, am: [...p.municao], gr: p.granadas, reloading: p.recarga > 0,
        ack: p.ack, wins: p.vitorias, kills: p.abates, deaths: p.mortes,
      })),
      gs: this.granadas.map((g) => ({ id: g.id, x: g.x, y: g.y, z: g.z })),
    };
  }
}
