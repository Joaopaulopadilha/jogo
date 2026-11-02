// Forma do mapa (só números, sem three.js): relevo, limites, o morro da comunidade no canto sudoeste e os lotes das casas.
// O terreno e a favela usam as mesmas funções, então todos os jogadores da sala veem exatamente o mesmo mapa.

export const TAMANHO = 120; // o terreno cobre -60 a 60 em x e z

const grampo = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export function suave(e0: number, e1: number, x: number): number {
  const t = grampo((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function ruido(x: number, z: number): number {
  return (
    Math.sin(x * 0.071 + 1.3) * Math.cos(z * 0.053) * 0.9 +
    Math.sin(x * 0.17 + z * 0.13) * 0.35 +
    Math.cos(x * 0.31 - z * 0.27) * 0.12
  );
}

// sudoeste = x negativo e z positivo. 0 perto da obra, 1 no canto
export function mascaraMorro(x: number, z: number): number {
  return suave(8, 22, -x) * suave(8, 22, z);
}

// até onde dá para ir (meia-largura do mapa jogável) em torno de (x, z): ±40 em geral, mas a entrada do sudoeste foi empurrada para ±56
export function limiteMapa(x: number, z: number): number {
  return 40 + 16 * suave(14, 30, -x) * suave(14, 30, z);
}

// mantém (x, z) dentro do mapa (com `extra` metros de folga além do começo da parede de morro; na abertura do sudoeste não há folga)
export function limitar(x: number, z: number, extra: number): [number, number] {
  for (let i = 0; i < 2; i++) {
    const aberto = (limiteMapa(x, z) - 40) / 16;
    const l = limiteMapa(x, z) + extra * (1 - aberto);
    x = grampo(x, -l, l);
    z = grampo(z, -l, l);
  }
  return [x, z];
}

// o morro: sobe devagar a partir da entrada e chega a 11 m no canto do mapa
export function alturaMorro(x: number, z: number): number {
  const u = (-x + z) / Math.SQRT2; // distância ao longo da diagonal sudoeste
  return 11 * suave(0, 1, (u - 26) / 52) * mascaraMorro(x, z);
}

// relevo antes de aplainar os terrenos das casas
export function alturaBase(x: number, z: number): number {
  const r = Math.hypot(x, z - 4);
  // a obra (centro) é plana; morros suaves em volta e uma borda mais alta fechando o mapa
  const plano = suave(18, 34, r);
  const borda = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - limiteMapa(x, z));
  const m = mascaraMorro(x, z);
  return ruido(x, z) * (1.6 * plano - 1.0 * m * plano) + borda * borda * 0.12 * (1 + borda * 0.3) * (1 - 0.8 * (limiteMapa(x, z) - 40) / 16) + alturaMorro(x, z);
}

// ---------------------------------------------------------------- lotes das casas

export type Lado = "L" | "O" | "N" | "S"; // leste (+x), oeste (-x), norte (-z), sul (+z)

export interface Lote {
  x: number; // centro
  z: number;
  w: number; // largura em x e profundidade em z (por dentro das paredes, sem a espessura)
  d: number;
  nivel: number; // altura do piso (terreno aplainado)
  porta: Lado; // parede da porta (sempre para o lado de baixo do morro: L ou N)
  escada: Lado; // parede por fora da qual a escada sobe até a laje
  cor: number; // índice da cor da pintura
  puxadinho: boolean; // quartinho em cima da laje
  semente: number;
}

export function gerador(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gerarLotes(): Lote[] {
  const rnd = gerador(20260211);
  const lotes: Lote[] = [];
  // grade de lotes bem junta (becos de uns 2,5 m), com as colunas alternadas para não ficar certinho
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const x = -52.5 + i * 6.9 + (rnd() - 0.5) * 0.5;
      const z = 20.5 + j * 7.1 + (i % 2) * 2.4 + (rnd() - 0.5) * 0.5;
      const u = (-x + z) / Math.SQRT2;
      const l = limiteMapa(x, z);
      const w = 4.0 + rnd() * 0.8;
      const d = 4.0 + rnd() * 0.8;
      const sorteio = [rnd(), rnd(), rnd(), rnd()];
      if (mascaraMorro(x, z) < 0.8 || u < 27 || Math.abs(x) + 4.5 > l || z + 4.5 > l) continue;
      const porta: Lado = sorteio[0] < 0.5 ? "L" : "N";
      lotes.push({
        x, z, w, d,
        nivel: Math.round(alturaBase(x, z) / 0.2) * 0.2,
        porta,
        escada: porta === "L" ? "S" : "O",
        cor: Math.floor(sorteio[1] * 10),
        puxadinho: sorteio[2] < 0.6,
        semente: Math.floor(sorteio[3] * 1e6),
      });
    }
  }
  return lotes;
}

export const LOTES: Lote[] = gerarLotes();

// O terreno só é aplainado na casa em si, mais a escada e o degrau da porta; o beco entre as casas vira rampa
const FALLOFF = 2.2;

function distanciaAoLote(l: Lote, x: number, z: number): number {
  const x0 = l.x - l.w / 2 - 0.7 - (l.escada === "O" ? 1.0 : 0);
  const x1 = l.x + l.w / 2 + 0.7 + (l.porta === "L" ? 0.6 : 0);
  const z0 = l.z - l.d / 2 - 0.7 - (l.porta === "N" ? 0.6 : 0);
  const z1 = l.z + l.d / 2 + 0.7 + (l.escada === "S" ? 1.0 : 0);
  return Math.hypot(Math.max(0, x0 - x, x - x1), Math.max(0, z0 - z, z - z1));
}

// quanto (0 a 1) o ponto está sobre o terreno aplainado de alguma casa
export function pesoPlataforma(x: number, z: number): number {
  let p = 0;
  for (const l of LOTES) {
    if (Math.abs(x - l.x) > 10 || Math.abs(z - l.z) > 10) continue;
    p = Math.max(p, 1 - suave(0, FALLOFF, distanciaAoLote(l, x, z)));
  }
  return p;
}

// quanto (0 a 1) o ponto é "chão da comunidade" (terra batida, e não mato)
export function pesoComunidade(x: number, z: number): number {
  const u = (-x + z) / Math.SQRT2;
  return mascaraMorro(x, z) * suave(24, 34, u);
}

// relevo final: o morro com os terrenos das casas aplainados (onde dois terrenos se tocam, a altura é a média ponderada)
export function alturaTerreno(x: number, z: number): number {
  const base = alturaBase(x, z);
  let somaP = 0;
  let somaH = 0;
  for (const l of LOTES) {
    if (Math.abs(x - l.x) > 10 || Math.abs(z - l.z) > 10) continue;
    const p = 1 - suave(0, FALLOFF, distanciaAoLote(l, x, z));
    if (p > 0) {
      somaP += p;
      somaH += l.nivel * p;
    }
  }
  if (somaP <= 0) return base;
  const t = Math.min(1, somaP);
  return base * (1 - t) + (somaH / somaP) * t;
}

// relevo do "fundo" da comunidade: fora do terreno jogável o morro continua subindo (só visual, ninguém chega lá)
export function alturaFundo(x: number, z: number): number {
  const xc = grampo(x, -60, 60);
  const zc = grampo(z, -60, 60);
  const dist = Math.hypot(x - xc, z - zc);
  return alturaTerreno(xc, zc) + dist * 0.45 + dist * dist * 0.004;
}
