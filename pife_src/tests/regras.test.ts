import assert from "node:assert/strict";
import {
  baralhos, bater, comprar, descartar, ehJogo, ehSequencia, ehTrinca, maoCompleta, melhorArranjo, novaPartida, podeBaterCom,
  responderOferta, vistaPara, type Carta, type Naipe, type Partida,
} from "../src/regras.ts";

let ok = 0;
function teste(nome: string, f: () => void): void {
  f();
  ok++;
  console.log("ok -", nome);
}

// "AP 10C 7O" -> cartas (A..K + naipe O/E/C/P); ids únicos
let prox = 1000;
function m(texto: string): Carta[] {
  return texto.trim().split(/\s+/).map((t) => {
    const v = t.slice(0, -1);
    const r = v === "A" ? 1 : v === "J" ? 11 : v === "Q" ? 12 : v === "K" ? 13 : Number(v);
    return { id: prox++, r, n: t.slice(-1) as Naipe };
  });
}

teste("dois baralhos: 104 cartas com ids únicos, cada carta duas vezes", () => {
  const b = baralhos();
  assert.equal(b.length, 104);
  assert.equal(new Set(b.map((c) => c.id)).size, 104);
  assert.equal(b.filter((c) => c.r === 7 && c.n === "C").length, 2);
});

teste("trinca: mesmo valor em naipes diferentes", () => {
  assert.ok(ehTrinca(m("7O 7C 7P")));
  assert.ok(ehTrinca(m("7O 7C 7P 7E")));
  assert.ok(!ehTrinca(m("7O 7O 7P"))); // naipe repetido (as duas cópias) não vale
  assert.ok(!ehTrinca(m("7O 7C")));
  assert.ok(!ehTrinca(m("7O 7C 8P")));
});

teste("sequência: mesmo naipe, seguidas, com Ás baixo ou alto e sem dar a volta", () => {
  assert.ok(ehSequencia(m("4C 5C 6C")));
  assert.ok(ehSequencia(m("6C 4C 5C"))); // em qualquer ordem
  assert.ok(ehSequencia(m("AC 2C 3C")));
  assert.ok(ehSequencia(m("QC KC AC")));
  assert.ok(ehSequencia(m("3P 4P 5P 6P 7P")));
  assert.ok(!ehSequencia(m("KC AC 2C"))); // não dá a volta
  assert.ok(!ehSequencia(m("4C 5C 6P")));
  assert.ok(!ehSequencia(m("4C 5C 5C")));
  assert.ok(!ehSequencia(m("4C 5C 7C")));
  assert.ok(!ehJogo(m("2C 5O 9P")));
});

teste("mão completa: três jogos, ou jogos maiores que somam 9", () => {
  assert.ok(maoCompleta(m("4C 5C 6C 9O 9P 9E JP QP KP")));
  assert.equal(maoCompleta(m("4C 5C 6C 9O 9P 9E JP QP KP"))!.length, 3);
  assert.ok(maoCompleta(m("AC 2C 3C 4C 5C 6C 7C 8C 9C"))); // sequência de 9
  assert.ok(maoCompleta(m("2O 3O 4O 5O 8P 8C 8E 8O QE"))=== null); // 4 + 4 + 1 solta
  assert.ok(maoCompleta(m("2O 3O 4O 5O 6O 8P 8C 8E 8O"))); // 5 + 4
  assert.equal(maoCompleta(m("4C 5C 6C 9O 9P 9E JP QP 2E")), null);
});

teste("a mesma carta disputada: o arranjo escolhe a divisão que fecha a mão", () => {
  // a sequência longa 2-3-4-5-6-7-8 de copas deixaria dois 5 sobrando: só fecha com o 5C indo para a trinca
  const r = maoCompleta(m("2C 3C 4C 5C 5O 5P 6C 7C 8C"));
  assert.ok(r);
  assert.equal(r!.length, 3);
  assert.ok(r!.some((g) => ehTrinca(g) && g.some((c) => c.n === "C")));
});

teste("melhor arranjo aponta os jogos prontos e as cartas soltas", () => {
  const a = melhorArranjo(m("4C 5C 6C 9O 9P 9E 2E JO KP"));
  assert.equal(a.jogos.length, 2);
  assert.equal(a.soltas.length, 3);
});

teste("bater com 10 cartas diz qual sobra", () => {
  const r = podeBaterCom(m("4C 5C 6C 9O 9P 9E JP QP KP 2E"));
  assert.ok(r);
  assert.equal(r!.sobra!.r, 2);
  assert.equal(podeBaterCom(m("4C 5C 6C 9O 9P 9E JP QP 3O 2E")), null);
});

// monta uma partida com mãos escolhidas
function montar(maos: string[], lixo: string, monte: string): Partida {
  const p = novaPartida(maos.length, maos.map((_, i) => "J" + i));
  p.maos = maos.map(m);
  p.lixo = m(lixo);
  p.monte = m(monte);
  p.vez = 0;
  p.fase = "comprar";
  return p;
}
const SOLTA = "2O 5E 9C KO 3P 7E JC 4O 10E";

teste("começo: 9 cartas para cada um, uma no lixo e o resto no monte", () => {
  for (const n of [2, 3, 4]) {
    const p = novaPartida(n, Array(n).fill("x"));
    assert.ok(p.maos.every((x) => x.length === 9));
    assert.equal(p.lixo.length, 1);
    assert.equal(p.monte.length, 104 - 9 * n - 1);
    const ids = [...p.maos.flat(), ...p.lixo, ...p.monte].map((c) => c.id);
    assert.equal(new Set(ids).size, 104);
  }
});

teste("ordem da vez: compra, descarta e passa; fora da vez não faz nada", () => {
  const p = montar([SOLTA, SOLTA], "6P", "8O 8P");
  assert.equal(comprar(p, 1, "monte"), false);
  assert.equal(descartar(p, 0, p.maos[0][0].id), false); // antes de comprar não descarta
  assert.ok(comprar(p, 0, "monte"));
  assert.equal(comprar(p, 0, "monte"), false); // só uma compra
  assert.equal(p.maos[0].length, 10);
  assert.ok(descartar(p, 0, p.maos[0][0].id));
  assert.equal(p.vez, 1);
  assert.equal(p.fase, "comprar");
});

teste("não pode devolver na mesma vez a carta pega do lixo", () => {
  const p = montar([SOLTA, SOLTA], "6P", "8O 8P");
  const topo = p.lixo[0];
  assert.ok(comprar(p, 0, "lixo"));
  assert.equal(descartar(p, 0, topo.id), false);
  assert.ok(descartar(p, 0, p.maos[0][0].id));
});

teste("bater na vez: vence, mostra os jogos e conta a vitória", () => {
  const p = montar(["4C 5C 6C 9O 9P 9E JP QP 2E", SOLTA], "6P", "8O KP");
  assert.equal(bater(p, 0), false); // ainda falta
  comprar(p, 0, "monte"); // vem o KP
  assert.equal(vistaPara(p, 0, [false, false]).possoBater, true);
  assert.ok(bater(p, 0));
  assert.equal(p.fase, "fim");
  assert.equal(p.vencedor, 0);
  assert.equal(p.vitorias[0], 1);
  assert.equal(p.jogosVencedores!.flat().length, 9);
  assert.equal(p.maos[0].length, 9);
  assert.equal(p.lixo.at(-1)!.r, 2); // a sobra foi para o lixo
});

teste("bater fora da vez com o descarte: na ordem da mesa, podendo passar", () => {
  const quase = "4C 5C 6C 9O 9P 9E JP QP 2E"; // bate com 10P ou KP
  const p = montar([SOLTA, SOLTA, quase], "6P", "8O KP"); // o jogador 0 compra KP
  comprar(p, 0, "monte");
  const kp = p.maos[0].at(-1)!;
  assert.ok(descartar(p, 0, kp.id));
  assert.equal(p.fase, "oferta");
  assert.deepEqual(p.ofertas, [2]);
  assert.equal(comprar(p, 1, "monte"), false); // o jogo espera a decisão
  assert.equal(responderOferta(p, 1, true), false); // não é dele
  assert.equal(vistaPara(p, 2, [false, false, false]).ofertaPraMim, true);
  assert.equal(vistaPara(p, 1, [false, false, false]).ofertaPraMim, false);
  assert.ok(responderOferta(p, 2, true));
  assert.equal(p.vencedor, 2);

  const q = montar([SOLTA, SOLTA, quase], "6P", "8O KP");
  comprar(q, 0, "monte");
  descartar(q, 0, q.maos[0].at(-1)!.id);
  assert.ok(responderOferta(q, 2, false)); // passou
  assert.equal(q.fase, "comprar");
  assert.equal(q.vez, 1); // segue a ordem depois de quem descartou
});

teste("o monte acabando, o lixo é embaralhado e vira monte", () => {
  const p = montar([SOLTA, SOLTA], "6P 7P 8P", "");
  p.monte = [];
  assert.ok(comprar(p, 0, "monte"));
  assert.equal(p.lixo.length, 1);
  assert.equal(p.monte.length, 1);
});

teste("ninguém enxerga a mão dos outros nem o monte", () => {
  const p = novaPartida(4, ["a", "b", "c", "d"]);
  const v = vistaPara(p, 0, [false, false, false, false]);
  const texto = JSON.stringify(v);
  const visiveis = new Set([...p.maos[0], p.lixo.at(-1)!].map((c) => c.id));
  for (const c of [...p.maos.slice(1).flat(), ...p.monte]) {
    if (!visiveis.has(c.id)) assert.ok(!texto.includes(`"id":${c.id},`), "vazou a carta " + c.id);
  }
});

console.log(`\n${ok} testes passaram`);
