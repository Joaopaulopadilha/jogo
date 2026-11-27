// Regras do jogo da velha: tabuleiro 3 x 3, três em linha vence. Nada aqui conhece rede nem tela.
// Casas numeradas de 0 a 8, por linhas: 0 1 2 / 3 4 5 / 6 7 8.

export type Peca = 0 | 1 | 2; // 0 = vazio, 1 = X, 2 = O
export type Jogador = 1 | 2;

export const LINHAS: readonly (readonly number[])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // deitadas
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // em pé
  [0, 4, 8], [2, 4, 6], // diagonais
];

export interface Estado {
  cel: Peca[];
  vez: Jogador;
  fim: boolean;
  vencedor: 0 | Jogador; // 0 = deu velha (quando fim)
  linha: number[] | null; // casas da linha vencedora
  jogadas: number;
}

export function novoEstado(comeca: Jogador = 1): Estado {
  return { cel: Array<Peca>(9).fill(0), vez: comeca, fim: false, vencedor: 0, linha: null, jogadas: 0 };
}

export function vazias(e: Estado): number[] {
  const v: number[] = [];
  e.cel.forEach((p, i) => { if (p === 0) v.push(i); });
  return v;
}

// joga na casa i; devolve false se a jogada não vale (fora da vez, casa ocupada, partida acabada...)
export function jogar(e: Estado, i: number, quem: Jogador): boolean {
  if (e.fim || quem !== e.vez || !Number.isInteger(i) || i < 0 || i > 8 || e.cel[i] !== 0) return false;
  e.cel[i] = quem;
  e.jogadas++;
  const ganhou = LINHAS.find((l) => l.every((c) => e.cel[c] === quem));
  if (ganhou) {
    e.fim = true;
    e.vencedor = quem;
    e.linha = [...ganhou];
    return true;
  }
  if (e.jogadas === 9) {
    e.fim = true; // deu velha
    return true;
  }
  e.vez = quem === 1 ? 2 : 1;
  return true;
}
