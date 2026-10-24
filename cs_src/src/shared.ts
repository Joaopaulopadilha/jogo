// shared.ts
// Constantes, mapa e física. Usado pelo host (autoritativo) e pela predição do convidado,
// por isso precisa ser determinístico: mesmo estado + mesmo comando = mesmo resultado.

import type { Cmd, Vec3 } from "./types";

export const MAX_JOGADORES = 4;
export const CORES = ["#4de2c2", "#ff5d73", "#ffd166", "#7c9cff"];

export const RAIO = 0.4;
export const ALTURA = 1.8;
export const OLHO = 1.62;
export const VELOCIDADE = 6;
export const PULO = 6.5;
export const GRAVIDADE = 18;
export const DEGRAU = 0.3; // altura máxima que se sobe andando

export const VIDA = 100;
export const ALCANCE = 120;

// armas de fogo (slots 1 e 2); o slot 3 é a granada
export interface Arma {
  nome: string;
  dano: number;
  intervalo: number; // s entre tiros
  pente: number;
  recarga: number;   // s
  dispersao: number; // rad
  auto: boolean;     // segurar o botão continua atirando
}

export const ARMAS: Arma[] = [
  { nome: "Rifle", dano: 22, intervalo: 0.11, pente: 30, recarga: 1.8, dispersao: 0.012, auto: true },
  { nome: "Pistola", dano: 34, intervalo: 0.25, pente: 12, recarga: 1.3, dispersao: 0.005, auto: false },
];
export const SLOT_GRANADA = 2;
export const NOMES_ARMAS = ["Rifle", "Pistola", "Granada"];

export const GRANADAS_POR_ROUND = 1;
export const GRANADA_RAIO = 0.12;
export const GRANADA_VELOCIDADE = 14;
export const GRANADA_FUSIVEL = 2;
export const EXPLOSAO_RAIO = 7;
export const EXPLOSAO_DANO = 120;

export const AQUECIMENTO = 3;
export const TEMPO_ROUND = 120;
export const FIM_ROUND = 3;
export const ROUNDS_PARA_VENCER = 5;

export const MAX_DT = 0.05;

export interface Caixa {
  x: number; // centro
  z: number;
  w: number; // tamanho em x
  d: number; // tamanho em z
  h: number; // altura (começa no chão)
  cor: number;
}

const PAREDE = 0x2a3a52;
const CAIXA = 0x8a6a3a;
const BLOCO = 0x3b4f6e;
const MURO = 0x4a5a74;

// arena 40x40: de -20 a 20
export const CAIXAS: Caixa[] = [
  // paredes externas
  { x: 0, z: -20.5, w: 42, d: 1, h: 5, cor: PAREDE },
  { x: 0, z: 20.5, w: 42, d: 1, h: 5, cor: PAREDE },
  { x: -20.5, z: 0, w: 1, d: 42, h: 5, cor: PAREDE },
  { x: 20.5, z: 0, w: 1, d: 42, h: 5, cor: PAREDE },
  // bloco central
  { x: 0, z: 0, w: 5, d: 5, h: 3, cor: BLOCO },
  // muros baixos (dá pra pular)
  { x: 0, z: -8, w: 6, d: 1, h: 1, cor: MURO },
  { x: 0, z: 8, w: 6, d: 1, h: 1, cor: MURO },
  { x: -8, z: 0, w: 1, d: 6, h: 1, cor: MURO },
  { x: 8, z: 0, w: 1, d: 6, h: 1, cor: MURO },
  // caixas altas
  { x: -12, z: -6, w: 2, d: 2, h: 2.2, cor: CAIXA },
  { x: 12, z: 6, w: 2, d: 2, h: 2.2, cor: CAIXA },
  { x: -6, z: 12, w: 2, d: 2, h: 2.2, cor: CAIXA },
  { x: 6, z: -12, w: 2, d: 2, h: 2.2, cor: CAIXA },
  // coberturas perto dos cantos
  { x: -13, z: -16, w: 1, d: 6, h: 2.5, cor: BLOCO },
  { x: 13, z: 16, w: 1, d: 6, h: 2.5, cor: BLOCO },
  { x: -13, z: 16, w: 1, d: 6, h: 2.5, cor: BLOCO },
  { x: 13, z: -16, w: 1, d: 6, h: 2.5, cor: BLOCO },
];

export interface Spawn {
  x: number;
  z: number;
  yaw: number;
}

function virado(x: number, z: number): Spawn {
  // olha para o centro; a frente com yaw é (-sin, -cos)
  return { x, z, yaw: Math.atan2(x, z) };
}

export const SPAWNS: Spawn[] = [
  virado(-16, -16),
  virado(16, 16),
  virado(16, -16),
  virado(-16, 16),
];

// ---- Física ----

export interface Corpo {
  x: number;
  y: number; // pés
  z: number;
  vy: number;
}

function alturaChao(x: number, y: number, z: number): number {
  let chao = 0;
  for (const c of CAIXAS) {
    if (Math.abs(x - c.x) < c.w / 2 + RAIO && Math.abs(z - c.z) < c.d / 2 + RAIO) {
      if (c.h <= y + DEGRAU && c.h > chao) chao = c.h;
    }
  }
  return chao;
}

function bloqueia(x: number, y: number, z: number, c: Caixa): boolean {
  return (
    c.h > y + DEGRAU &&
    Math.abs(x - c.x) < c.w / 2 + RAIO &&
    Math.abs(z - c.z) < c.d / 2 + RAIO
  );
}

function moverEixo(b: Corpo, dx: number, dz: number): void {
  if (dx !== 0) {
    b.x += dx;
    for (const c of CAIXAS) {
      if (bloqueia(b.x, b.y, b.z, c)) {
        b.x = dx > 0 ? c.x - c.w / 2 - RAIO : c.x + c.w / 2 + RAIO;
      }
    }
  }
  if (dz !== 0) {
    b.z += dz;
    for (const c of CAIXAS) {
      if (bloqueia(b.x, b.y, b.z, c)) {
        b.z = dz > 0 ? c.z - c.d / 2 - RAIO : c.z + c.d / 2 + RAIO;
      }
    }
  }
}

const PASSO_MAX = 1 / 60;

export function moverCorpo(b: Corpo, cmd: Pick<Cmd, "dt" | "fwd" | "strafe" | "jump" | "yaw">): void {
  let restante = Math.min(cmd.dt, MAX_DT);
  const sin = Math.sin(cmd.yaw);
  const cos = Math.cos(cmd.yaw);
  let wx = cmd.fwd * -sin + cmd.strafe * cos;
  let wz = cmd.fwd * -cos + cmd.strafe * -sin;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }

  while (restante > 1e-6) {
    const dt = Math.min(restante, PASSO_MAX);
    restante -= dt;

    moverEixo(b, wx * VELOCIDADE * dt, wz * VELOCIDADE * dt);

    const chao = alturaChao(b.x, b.y, b.z);
    if (cmd.jump && b.y <= chao + 1e-4 && b.vy <= 0) b.vy = PULO;
    b.vy -= GRAVIDADE * dt;
    b.y += b.vy * dt;
    if (b.y <= chao) {
      b.y = chao;
      b.vy = 0;
    }
  }
}

// ---- Raycast ----

// interseção raio x caixa (slab); retorna a distância ou null
export function raioCaixa(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
    } else {
      let t1 = (min[i] - o[i]) / d[i];
      let t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return Math.max(tmin, 0);
}

export function direcao(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}
