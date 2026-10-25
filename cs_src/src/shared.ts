// shared.ts
// Constantes, mapa e física. Usado pelo host (autoritativo) e pela predição do convidado,
// por isso precisa ser determinístico: mesmo estado + mesmo comando = mesmo resultado.

import colisoesModelos from "./colisoes.json";
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
  oculta?: boolean; // só colide: o visual é um modelo 3D (ver OBJETOS)
}

// arena 60x60: de -30 a 30
export const ARENA = 30;

// Cenário: modelos 3D (feitos no Blender, pasta modelos/) colocados no mapa. A colisão de cada modelo vem de src/colisoes.json,
// gerado pelos mesmos scripts que desenham o modelo, então o que se vê é o que bloqueia. O yaw é sempre múltiplo de 90°.
export interface Objeto3D { arquivo: string; x: number; z: number; yaw: number }
const P = Math.PI;
export const OBJETOS: Objeto3D[] = [
  // centro
  { arquivo: "blindado_semidestruido", x: 0, z: 0, yaw: 0 },
  { arquivo: "sacos", x: 0, z: -7.5, yaw: 0 },
  { arquivo: "sacos", x: 0, z: 7.5, yaw: 0 },
  { arquivo: "barreira", x: -8, z: 0, yaw: 0 },
  { arquivo: "barreira", x: 8, z: 0, yaw: 0 },
  { arquivo: "barris", x: 4.5, z: -4, yaw: 0 },
  { arquivo: "barris", x: -4.5, z: 4, yaw: P },
  { arquivo: "pneus", x: 4.5, z: 4.5, yaw: 0 },
  { arquivo: "pneus", x: -4.5, z: -4.5, yaw: 0 },
  // construções nos cantos
  { arquivo: "casa", x: -20, z: -17, yaw: 0 },
  { arquivo: "casa", x: 20, z: 17, yaw: P },
  { arquivo: "predio", x: 19, z: -18, yaw: P / 2 },
  { arquivo: "casa", x: -19, z: 19, yaw: -P / 2 },
  // contêineres e veículos entre o centro e os cantos
  { arquivo: "container_a", x: -6, z: -21, yaw: 0 },
  { arquivo: "container_b", x: 7, z: 22, yaw: 0 },
  { arquivo: "container_b", x: -26, z: 3, yaw: P / 2 },
  { arquivo: "container_a", x: 26, z: -3, yaw: P / 2 },
  { arquivo: "carro_destruido", x: -12.5, z: 9, yaw: P / 2 },
  { arquivo: "carro_destruido", x: 12.5, z: -9, yaw: -P / 2 },
  { arquivo: "carro_destruido", x: -2, z: 26, yaw: 0 },
  // coberturas menores espalhadas
  { arquivo: "caixotes", x: -12, z: -10, yaw: 0 },
  { arquivo: "caixotes", x: 12, z: 10, yaw: P },
  { arquivo: "caixotes", x: 27, z: 10, yaw: P / 2 },
  { arquivo: "caixotes", x: -27, z: -10, yaw: -P / 2 },
  { arquivo: "barreira", x: -14, z: -2, yaw: P / 2 },
  { arquivo: "barreira", x: 14, z: 2, yaw: P / 2 },
  { arquivo: "barreira", x: 2, z: -15, yaw: 0 },
  { arquivo: "barreira", x: -2, z: 15, yaw: 0 },
  { arquivo: "sacos", x: -10, z: 22, yaw: 0 },
  { arquivo: "sacos", x: 10, z: -23, yaw: 0 },
  { arquivo: "barris", x: -27, z: -26, yaw: 0 },
  { arquivo: "barris", x: 27, z: 26, yaw: P },
  { arquivo: "barris", x: 8, z: 14, yaw: 0 },
  { arquivo: "barris", x: -8, z: -14, yaw: P },
  { arquivo: "pneus", x: -16, z: 8, yaw: 0 },
  { arquivo: "pneus", x: 16, z: -8, yaw: 0 },
  { arquivo: "pneus", x: 26, z: -26, yaw: 0 },
  { arquivo: "pneus", x: -26, z: 26, yaw: 0 },
];

interface CaixaModelo { x: number; z: number; w: number; d: number; h: number }
const COR_OBJETO = 0x3b4f6e;

function caixasDe(o: Objeto3D): Caixa[] {
  const lista = (colisoesModelos as Record<string, CaixaModelo[]>)[o.arquivo] ?? [];
  const c = Math.round(Math.cos(o.yaw));
  const sn = Math.round(Math.sin(o.yaw));
  const gira = sn !== 0;
  // rotação em torno de Y (a mesma do Three.js): x' = x cos + z sin, z' = -x sin + z cos
  return lista.map((b) => ({
    x: o.x + b.x * c + b.z * sn,
    z: o.z - b.x * sn + b.z * c,
    w: gira ? b.d : b.w,
    d: gira ? b.w : b.d,
    h: b.h,
    cor: COR_OBJETO,
    oculta: true,
  }));
}

const PAREDE = 0x2a3a52;
export const CAIXAS: Caixa[] = [
  // paredes externas (a borda da arena)
  { x: 0, z: -ARENA - 0.5, w: ARENA * 2 + 2, d: 1, h: 5, cor: PAREDE },
  { x: 0, z: ARENA + 0.5, w: ARENA * 2 + 2, d: 1, h: 5, cor: PAREDE },
  { x: -ARENA - 0.5, z: 0, w: 1, d: ARENA * 2 + 2, h: 5, cor: PAREDE },
  { x: ARENA + 0.5, z: 0, w: 1, d: ARENA * 2 + 2, h: 5, cor: PAREDE },
  ...OBJETOS.flatMap(caixasDe),
];

export interface Spawn {
  x: number;
  z: number;
  yaw: number;
}

// ---- Nascimento aleatório ----
// Candidatos: uma grade sobre a arena, sem os pontos perto de qualquer obstáculo nem dentro das construções.
// A cada rodada sorteia-se um conjunto: bem afastados entre si e, quando possível, sem linha de visão direta.
const MARGEM_SPAWN = 1.3;
const CONSTRUCOES = OBJETOS.filter((o) => o.arquivo === "casa" || o.arquivo === "predio");

function pontoLivre(x: number, z: number): boolean {
  if (Math.abs(x) > ARENA - 1.5 || Math.abs(z) > ARENA - 1.5) return false;
  for (const c of CAIXAS) {
    if (Math.abs(x - c.x) < c.w / 2 + RAIO + MARGEM_SPAWN && Math.abs(z - c.z) < c.d / 2 + RAIO + MARGEM_SPAWN) return false;
  }
  // dentro de uma casa ou prédio (a caixa de uma construção é a área toda dela)
  for (const o of CONSTRUCOES) {
    const meio = o.arquivo === "casa" ? [5.8, 4.8] : [7.8, 5.8];
    const gira = Math.round(Math.sin(o.yaw)) !== 0;
    const mx = gira ? meio[1] : meio[0];
    const mz = gira ? meio[0] : meio[1];
    if (Math.abs(x - o.x) < mx && Math.abs(z - o.z) < mz) return false;
  }
  return true;
}

export const POSTOS_SPAWN: { x: number; z: number }[] = [];
for (let gx = -27; gx <= 27; gx += 3) {
  for (let gz = -27; gz <= 27; gz += 3) {
    if (pontoLivre(gx, gz)) POSTOS_SPAWN.push({ x: gx, z: gz });
  }
}

function seVeem(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const o: Vec3 = [a.x, 1.5, a.z];
  const v: Vec3 = [b.x - a.x, 0, b.z - a.z];
  const dist = Math.hypot(v[0], v[2]);
  const d: Vec3 = [v[0] / dist, 0, v[2] / dist];
  return !CAIXAS.some((c) => {
    if (c.h < 1.6) return false; // coberturas baixas não escondem ninguém em pé
    const t = raioCaixa(o, d, [c.x - c.w / 2, 0, c.z - c.d / 2], [c.x + c.w / 2, c.h, c.z + c.d / 2]);
    return t !== null && t < dist;
  });
}

export function sortearSpawns(n: number, azar: () => number = Math.random): Spawn[] {
  let melhor: { x: number; z: number }[] = [];
  let melhorNota = -Infinity;
  for (let tentativa = 0; tentativa < 90; tentativa++) {
    const escolha: { x: number; z: number }[] = [];
    while (escolha.length < n) {
      const p = POSTOS_SPAWN[Math.floor(azar() * POSTOS_SPAWN.length)];
      if (!escolha.includes(p)) escolha.push(p);
    }
    let menor = Infinity;
    let visiveis = 0;
    for (let i = 0; i < n; i++) {
      for (let k = i + 1; k < n; k++) {
        menor = Math.min(menor, Math.hypot(escolha[i].x - escolha[k].x, escolha[i].z - escolha[k].z));
        if (seVeem(escolha[i], escolha[k])) visiveis++;
      }
    }
    const nota = Math.min(menor, 24) - 9 * visiveis + azar() * 3;
    if (nota > melhorNota) { melhorNota = nota; melhor = escolha; }
  }
  // o jogador olha mais ou menos para o meio da arena, com uma variação
  return melhor.map((p) => ({ x: p.x, z: p.z, yaw: Math.atan2(p.x, p.z) + (azar() - 0.5) * 1.8 }));
}

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

// folga numérica: encostar exatamente na face de uma parede (distância == meia largura + raio)
// não pode contar como "dentro" por causa de arredondamento, senão a resolução abaixo
// teletransporta o corpo para a outra ponta da parede
const FOLGA = 1e-4;

function bloqueia(x: number, y: number, z: number, c: Caixa): boolean {
  return (
    c.h > y + DEGRAU &&
    Math.abs(x - c.x) < c.w / 2 + RAIO - FOLGA &&
    Math.abs(z - c.z) < c.d / 2 + RAIO - FOLGA
  );
}

// encosta na face da caixa só se o corpo vinha de fora dela; se já estava dentro, volta ao ponto anterior
function encostar(antes: number, delta: number, faceMenor: number, faceMaior: number): number {
  const face = delta > 0 ? faceMenor : faceMaior;
  const veioDeFora = delta > 0 ? antes <= face + FOLGA : antes >= face - FOLGA;
  return veioDeFora ? face : antes;
}

function moverEixo(b: Corpo, dx: number, dz: number): void {
  if (dx !== 0) {
    const antes = b.x;
    b.x += dx;
    for (const c of CAIXAS) {
      if (bloqueia(b.x, b.y, b.z, c)) {
        b.x = encostar(antes, dx, c.x - c.w / 2 - RAIO, c.x + c.w / 2 + RAIO);
      }
    }
  }
  if (dz !== 0) {
    const antes = b.z;
    b.z += dz;
    for (const c of CAIXAS) {
      if (bloqueia(b.x, b.y, b.z, c)) {
        b.z = encostar(antes, dz, c.z - c.d / 2 - RAIO, c.z + c.d / 2 + RAIO);
      }
    }
  }
}

const PASSO_MAX = 1 / 60;
const LIMITE_ARENA = ARENA - RAIO;

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
    // rede de segurança: nada sai da arena (as paredes internas ficam em +-ARENA), e quem já saiu volta
    b.x = Math.max(-LIMITE_ARENA, Math.min(LIMITE_ARENA, b.x));
    b.z = Math.max(-LIMITE_ARENA, Math.min(LIMITE_ARENA, b.z));

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
