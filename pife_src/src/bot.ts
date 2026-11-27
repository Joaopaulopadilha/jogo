// Cérebro dos bots: só olha a própria mão e o topo do lixo (o que um jogador de verdade veria).

import { melhorArranjo, podeBaterCom, type Carta, type Partida } from "./regras.ts";

// quão perto de formar um jogo estão duas cartas soltas (0 = nada)
function ligacao(a: Carta, b: Carta): number {
  if (a.r === b.r) return a.n !== b.n ? 3 : 0; // par para trinca
  if (a.n !== b.n) return 0;
  let d = Math.abs(a.r - b.r);
  if (a.r === 1 || b.r === 1) d = Math.min(d, Math.abs(14 - Math.max(a.r, b.r))); // Ás alto
  if (d === 1) return 3; // vizinhas: duas pontas
  if (d === 2) return 2; // falta a do meio
  return 0;
}

// nota de uma mão: cartas em jogos valem muito; depois, as ligações entre as soltas
export function notaDaMao(mao: Carta[]): number {
  const a = melhorArranjo(mao);
  let nota = (mao.length - a.soltas.length) * 100;
  for (const c of a.soltas) {
    let melhor = 0;
    let soma = 0;
    for (const o of a.soltas) {
      if (o === c) continue;
      const l = ligacao(c, o);
      melhor = Math.max(melhor, l);
      soma += l;
    }
    nota += melhor * 4 + soma * 0.5;
  }
  return nota;
}

// vale a pena pegar o lixo? Só se ele melhora a mão de verdade (entra num jogo ou cria uma boa ligação)
export function pegarDoLixo(p: Partida, seat: number): boolean {
  const topo = p.lixo[p.lixo.length - 1];
  if (!topo) return false;
  const mao = p.maos[seat];
  if (podeBaterCom([...mao, topo])) return true;
  const agora = melhorArranjo(mao);
  const com = melhorArranjo([...mao, topo]);
  const antes = mao.length - agora.soltas.length;
  const depois = mao.length + 1 - com.soltas.length;
  if (depois <= antes) return false;
  return com.jogos.some((g) => g.some((c) => c.id === topo.id));
}

// qual carta jogar fora: a que deixa a melhor mão com as outras 9
export function escolherDescarte(p: Partida, seat: number, rnd: () => number = Math.random): number {
  const mao = p.maos[seat];
  let melhor = mao[0].id;
  let melhorNota = -Infinity;
  for (const c of mao) {
    if (c.id === p.doLixo) continue;
    const nota = notaDaMao(mao.filter((o) => o.id !== c.id)) + rnd() * 2;
    if (nota > melhorNota) { melhorNota = nota; melhor = c.id; }
  }
  return melhor;
}
