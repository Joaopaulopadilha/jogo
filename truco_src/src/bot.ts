// Cérebro simples dos bots: joga carta, pede truco e responde pedidos. Só olha o que um jogador de verdade veria
// (a própria mão, a mesa e as vazas), nunca a mão dos outros.

import { forca, podeAumentar, timeDe, type Partida, type Resposta } from "./regras.ts";

// 0 (4 de ouros) até 1 (zap): quanto mais perto de 1, mais forte
function nota(p: Partida, seat: number, i: number): number {
  const f = forca(p.maos[seat][i], p.manilha);
  if (f >= 100) return 0.78 + (f - 100) * 0.073; // manilhas: 0.78 a 1
  return (f / 9) * 0.62; // 4..3 normais: 0 a 0.62
}

function notas(p: Partida, seat: number): number[] {
  return p.maos[seat].map((_, i) => nota(p, seat, i));
}

// força da mão do bot (0 a 1), contando as vazas que o time dele já ganhou
export function forcaDaMao(p: Partida, seat: number): number {
  const n = notas(p, seat);
  if (n.length === 0) return 0;
  n.sort((a, b) => b - a);
  const melhores = n.slice(0, 2);
  let f = melhores.reduce((s, x) => s + x, 0) / melhores.length;
  const meu = timeDe(seat);
  const ganhei = p.vazas.filter((v) => v === meu).length;
  const perdi = p.vazas.filter((v) => v === 1 - meu).length;
  if (ganhei > perdi) f += 0.12; // já saiu na frente: basta uma carta boa
  if (perdi > ganhei) f -= 0.12;
  return Math.max(0, Math.min(1, f));
}

// índice da carta que o bot joga
export function escolherCarta(p: Partida, seat: number, rnd: () => number = Math.random): number {
  const n = notas(p, seat);
  const idx = n.map((_, i) => i).sort((a, b) => n[a] - n[b]); // do mais fraco ao mais forte
  const meu = timeDe(seat);

  if (p.vazaCartas.length === 0) {
    // abrindo a vaza
    if (idx.length === 1) return idx[0];
    const ganhei = p.vazas.filter((v) => v === meu).length;
    const perdi = p.vazas.filter((v) => v === 1 - meu).length;
    if (p.vazas.length === 0) {
      // primeira vaza: com mão forte abre no meio para esconder; com mão fraca joga a mais fraca
      return forcaDaMao(p, seat) > 0.6 ? idx[Math.floor(idx.length / 2)] : idx[0];
    }
    if (ganhei > perdi) return idx[Math.floor(idx.length / 2)]; // já ganhou uma: guarda a melhor
    return idx[idx.length - 1]; // precisa ganhar: joga a mais forte
  }

  // respondendo: quem está ganhando a vaza agora?
  let melhorForca = -1;
  let melhorTime: number = -1;
  for (const j of p.vazaCartas) {
    const f = forca(j.carta, p.manilha);
    if (f > melhorForca) {
      melhorForca = f;
      melhorTime = timeDe(j.seat);
    } else if (f === melhorForca && timeDe(j.seat) !== melhorTime) {
      melhorTime = -1;
    }
  }
  if (melhorTime === meu) return idx[0]; // o parceiro está ganhando: joga a mais fraca
  const ultimo = p.vazaCartas.length === p.n - 1;
  // a carta mais fraca que ganha (ou, se for o último a jogar, a que empata só se não houver outra)
  for (const i of idx) {
    if (forca(p.maos[seat][i], p.manilha) > melhorForca) return i;
  }
  if (ultimo && p.vazas.length === 0 && rnd() < 0.25) {
    const empate = idx.find((i) => forca(p.maos[seat][i], p.manilha) === melhorForca);
    if (empate !== undefined) return empate;
  }
  return idx[0]; // não dá para ganhar: joga a mais fraca
}

// o bot pede aumento agora? (já devolve false se não puder)
export function querAumentar(p: Partida, seat: number, rnd: () => number = Math.random): boolean {
  if (!podeAumentar(p, seat)) return false;
  const f = forcaDaMao(p, seat);
  const ousadia = 0.1 + p.valor * 0.01;
  if (f > 0.8) return rnd() < 0.5;
  if (f > 0.62) return rnd() < 0.18;
  if (f < 0.25 && p.vazas.length >= 1) return rnd() < ousadia * 0.4; // blefe raro
  return false;
}

// resposta do bot a um pedido de aumento
export function responderPedido(p: Partida, seat: number, rnd: () => number = Math.random): Resposta {
  const ped = p.pedido;
  if (!ped) return "aceitar";
  const f = forcaDaMao(p, seat);
  // quanto maior o valor pedido, mais forte a mão precisa ser
  const exigencia = ped.valor === 3 ? 0.42 : ped.valor === 6 ? 0.55 : ped.valor === 9 ? 0.66 : 0.74;
  if (ped.valor < 12 && f > 0.85 && rnd() < 0.5) return "aumentar";
  if (f + (rnd() - 0.5) * 0.16 >= exigencia) return "aceitar";
  return "correr";
}

// mão de onze: o bot joga ou corre (vê a própria mão e a do parceiro)
export function jogarOnze(p: Partida, time: 0 | 1): boolean {
  const seats = [0, 1, 2, 3].filter((s) => s < p.n && timeDe(s) === time);
  const total = seats.map((s) => forcaDaMao(p, s)).reduce((a, b) => a + b, 0) / seats.length;
  return total >= 0.5;
}
