// Computador. "impossivel": joga a jogada perfeita (nunca perde). "normal": às vezes se distrai, dá para ganhar.

import { LINHAS, vazias, type Estado, type Jogador } from "./regras.ts";

export type Nivel = "normal" | "impossivel";

// valor da posição para quem vai jogar: >0 ganha, 0 empata, <0 perde (vitória mais rápida vale mais)
function valor(cel: number[], quem: Jogador, memoria: Map<string, number>): number {
  const outro: Jogador = quem === 1 ? 2 : 1;
  const livres = cel.filter((p) => p === 0).length;
  if (LINHAS.some((l) => l.every((c) => cel[c] === outro))) return -(livres + 1);
  if (livres === 0) return 0;
  const chave = cel.join("") + quem;
  const sabido = memoria.get(chave);
  if (sabido !== undefined) return sabido;
  let melhor = -Infinity;
  for (let i = 0; i < 9; i++) {
    if (cel[i] !== 0) continue;
    cel[i] = quem;
    melhor = Math.max(melhor, -valor(cel, outro, memoria));
    cel[i] = 0;
  }
  memoria.set(chave, melhor);
  return melhor;
}

const memoria = new Map<string, number>();

// casa que completa uma linha de `quem`, ou -1
function completa(e: Estado, quem: Jogador): number {
  for (const l of LINHAS) {
    if (l.filter((c) => e.cel[c] === quem).length === 2) {
      const vazia = l.find((c) => e.cel[c] === 0);
      if (vazia !== undefined) return vazia;
    }
  }
  return -1;
}

function perfeita(e: Estado, quem: Jogador, rnd: () => number): number {
  const outro: Jogador = quem === 1 ? 2 : 1;
  const cel = [...e.cel];
  let melhor = -Infinity;
  let opcoes: number[] = [];
  for (const i of vazias(e)) {
    cel[i] = quem;
    const v = -valor(cel, outro, memoria);
    cel[i] = 0;
    if (v > melhor) { melhor = v; opcoes = [i]; }
    else if (v === melhor) opcoes.push(i);
  }
  return opcoes[Math.floor(rnd() * opcoes.length)];
}

export function escolherJogada(e: Estado, quem: Jogador, nivel: Nivel = "normal", rnd: () => number = Math.random): number {
  const livres = vazias(e);
  if (nivel === "impossivel") return perfeita(e, quem, rnd);
  const ganhar = completa(e, quem);
  if (ganhar >= 0) return ganhar; // nunca deixa passar a própria vitória
  const bloquear = completa(e, quem === 1 ? 2 : 1);
  if (bloquear >= 0 && rnd() < 0.8) return bloquear;
  if (rnd() < 0.5) return perfeita(e, quem, rnd);
  return livres[Math.floor(rnd() * livres.length)];
}
