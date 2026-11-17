import assert from "node:assert/strict";
import {
  avancar, comecarMao, decidirOnze, forca, jogar, manilhaDe, novaPartida, pedirAumento, proximaMao, resolver, responder,
  type Carta, type Partida,
} from "../src/regras.ts";

const c = (r: string, n: Carta["n"]): Carta => ({ r, n });
let ok = 0;
function teste(nome: string, f: () => void): void {
  f();
  ok++;
  console.log("ok -", nome);
}

// partida com mãos e vira escolhidas a dedo
function montar(n: 2 | 4, maos: Carta[][], vira: Carta): Partida {
  const p = novaPartida(n, ["A", "B", "C", "D"].slice(0, n));
  p.maos = maos;
  p.vira = vira;
  p.manilha = manilhaDe(vira);
  return p;
}

teste("manilha é a carta seguinte à vira", () => {
  assert.equal(manilhaDe(c("4", "O")), "5");
  assert.equal(manilhaDe(c("7", "P")), "Q");
  assert.equal(manilhaDe(c("K", "C")), "A");
  assert.equal(manilhaDe(c("3", "E")), "4"); // depois do 3 volta ao 4
});

teste("força: manilha > 3 > 2 > A, e zap > copas > espadas > ouros", () => {
  const m = "Q";
  assert.ok(forca(c("Q", "P"), m) > forca(c("Q", "C"), m));
  assert.ok(forca(c("Q", "C"), m) > forca(c("Q", "E"), m));
  assert.ok(forca(c("Q", "E"), m) > forca(c("Q", "O"), m));
  assert.ok(forca(c("Q", "O"), m) > forca(c("3", "P"), m));
  assert.ok(forca(c("3", "O"), m) > forca(c("2", "O"), m));
  assert.ok(forca(c("2", "O"), m) > forca(c("A", "O"), m));
  assert.ok(forca(c("A", "O"), m) > forca(c("K", "O"), m));
  assert.ok(forca(c("5", "O"), m) > forca(c("4", "O"), m));
});

teste("resolver: combinações de vazas e empates", () => {
  assert.equal(resolver([0]), undefined);
  assert.equal(resolver([0, 0]), 0);
  assert.equal(resolver([1, 1]), 1);
  assert.equal(resolver([0, 1]), undefined);
  assert.equal(resolver([0, 1, 1]), 1);
  assert.equal(resolver([0, 1, 0]), 0);
  assert.equal(resolver([-1, 1]), 1); // empatou a primeira: ganha a segunda
  assert.equal(resolver([0, -1]), 0); // empatou a segunda: ganha a primeira
  assert.equal(resolver([-1, -1]), undefined);
  assert.equal(resolver([-1, -1, 1]), 1);
  assert.equal(resolver([-1, -1, -1]), -1); // tudo empatado: ninguém pontua
  assert.equal(resolver([0, 1, -1]), 0); // terceira empatou: vale a primeira
});

teste("1x1: cada mão tem 3 cartas e quem não é o dador abre", () => {
  const p = novaPartida(2, ["A", "B"]);
  assert.equal(p.maos.length, 2);
  assert.ok(p.maos.every((m) => m.length === 3));
  assert.equal(p.vez, 0);
  const todas = new Set([...p.maos.flat(), p.vira].map((x) => x.r + x.n));
  assert.equal(todas.size, 7); // sem cartas repetidas
});

teste("vaza: maior carta ganha e abre a próxima", () => {
  const p = montar(2, [[c("4", "O"), c("5", "O"), c("6", "O")], [c("A", "P"), c("7", "P"), c("K", "P")]], c("2", "C")); // manilha = 3
  assert.ok(jogar(p, 0, 0));
  assert.equal(p.vez, 1);
  assert.ok(jogar(p, 1, 0)); // A de paus ganha do 4
  assert.equal(p.fase, "vazaFechada");
  assert.deepEqual(p.vazas, [1]);
  avancar(p);
  assert.equal(p.fase, "jogando");
  assert.equal(p.vez, 1); // quem ganhou abre
  assert.equal(p.vazaCartas.length, 0);
});

teste("não deixa jogar fora da vez nem carta inexistente", () => {
  const p = montar(2, [[c("4", "O"), c("5", "O"), c("6", "O")], [c("A", "P"), c("7", "P"), c("K", "P")]], c("2", "C"));
  assert.equal(jogar(p, 1, 0), false);
  assert.equal(jogar(p, 0, 5), false);
  assert.equal(jogar(p, 0, -1), false);
  assert.equal(jogar(p, 0, 0.5), false);
});

teste("duas vazas seguidas fecham a mão (1 ponto)", () => {
  const p = montar(2, [[c("A", "P"), c("K", "P"), c("J", "P")], [c("4", "O"), c("5", "O"), c("6", "O")]], c("2", "C"));
  jogar(p, 0, 0); jogar(p, 1, 0); avancar(p);
  jogar(p, 0, 0); jogar(p, 1, 0); avancar(p);
  assert.equal(p.fase, "fimMao");
  assert.deepEqual(p.pontos, [1, 0]);
  proximaMao(p);
  assert.equal(p.fase, "jogando");
  assert.equal(p.dador, 0); // o dador gira
  assert.equal(p.vez, 1); // e abre quem vem depois dele
});

teste("empate na primeira: a segunda decide", () => {
  const p = montar(2, [[c("4", "O"), c("A", "P"), c("K", "O")], [c("4", "E"), c("5", "O"), c("6", "O")]], c("2", "C"));
  jogar(p, 0, 0); jogar(p, 1, 0);
  assert.deepEqual(p.vazas, [-1]);
  avancar(p);
  assert.equal(p.vez, 0); // quem abriu abre de novo
  jogar(p, 0, 0); jogar(p, 1, 0); // A ganha do 5
  avancar(p);
  assert.equal(p.fase, "fimMao");
  assert.deepEqual(p.pontos, [1, 0]);
});

teste("4 jogadores: dupla com a carta mais alta ganha, empate entre adversários embucha", () => {
  const p = montar(4, [[c("A", "O")], [c("A", "E")], [c("K", "O")], [c("5", "O")]], c("2", "C"));
  jogar(p, 0, 0); jogar(p, 1, 0); jogar(p, 2, 0); jogar(p, 3, 0);
  assert.deepEqual(p.vazas, [-1]); // dois ases de times diferentes
  const q = montar(4, [[c("A", "O")], [c("K", "E")], [c("A", "E")], [c("5", "O")]], c("2", "C"));
  jogar(q, 0, 0); jogar(q, 1, 0); jogar(q, 2, 0); jogar(q, 3, 0);
  assert.deepEqual(q.vazas, [0]); // ases do mesmo time: time 1 leva
  assert.equal(q.ultimaVaza?.vencedor, 0);
});

teste("truco: aceitar, e só o outro time pode aumentar depois", () => {
  const p = montar(2, [[c("A", "P"), c("K", "P"), c("J", "P")], [c("4", "O"), c("5", "O"), c("6", "O")]], c("2", "C"));
  assert.ok(pedirAumento(p, 0));
  assert.equal(p.pedido?.valor, 3);
  assert.equal(jogar(p, 0, 0), false); // com pedido pendente ninguém joga
  assert.equal(responder(p, 0, "aceitar"), false); // quem pediu não responde
  assert.ok(responder(p, 1, "aceitar"));
  assert.equal(p.valor, 3);
  assert.equal(pedirAumento(p, 0), false); // o mesmo time não aumenta de novo
  jogar(p, 0, 0); // vez do 1
  assert.ok(pedirAumento(p, 1)); // seis
  assert.equal(p.pedido?.valor, 6);
});

teste("correr do truco dá 1 ponto; correr do seis dá 3", () => {
  const p = montar(2, [[c("A", "P"), c("K", "P"), c("J", "P")], [c("4", "O"), c("5", "O"), c("6", "O")]], c("2", "C"));
  pedirAumento(p, 0);
  responder(p, 1, "correr");
  assert.deepEqual(p.pontos, [1, 0]);
  assert.equal(p.fase, "fimMao");

  const q = montar(2, [[c("A", "P"), c("K", "P"), c("J", "P")], [c("4", "O"), c("5", "O"), c("6", "O")]], c("2", "C"));
  pedirAumento(q, 0);
  assert.ok(responder(q, 1, "aumentar")); // seis, na resposta
  assert.equal(q.pedido?.valor, 6);
  assert.equal(q.valor, 3);
  responder(q, 0, "correr");
  assert.deepEqual(q.pontos, [0, 3]);
});

teste("subir até doze e não passar disso", () => {
  const p = montar(2, [[c("A", "P"), c("K", "P"), c("J", "P")], [c("4", "O"), c("5", "O"), c("6", "O")]], c("2", "C"));
  pedirAumento(p, 0);
  responder(p, 1, "aumentar"); // 6
  responder(p, 0, "aumentar"); // 9
  responder(p, 1, "aumentar"); // 12
  assert.equal(p.pedido?.valor, 12);
  assert.equal(responder(p, 0, "aumentar"), false);
  assert.ok(responder(p, 0, "aceitar"));
  assert.equal(p.valor, 12);
  assert.equal(pedirAumento(p, 0), false);
});

teste("mão vale o que foi aceito: vencer com truco soma 3", () => {
  const p = montar(2, [[c("A", "P"), c("K", "P"), c("J", "P")], [c("4", "O"), c("5", "O"), c("6", "O")]], c("2", "C"));
  pedirAumento(p, 0);
  responder(p, 1, "aceitar");
  jogar(p, 0, 0); jogar(p, 1, 0); avancar(p);
  jogar(p, 0, 0); jogar(p, 1, 0); avancar(p);
  assert.deepEqual(p.pontos, [3, 0]);
});

teste("12 pontos encerram a partida", () => {
  const p = montar(2, [[c("A", "P"), c("K", "P"), c("J", "P")], [c("4", "O"), c("5", "O"), c("6", "O")]], c("2", "C"));
  p.pontos = [10, 0];
  pedirAumento(p, 0);
  responder(p, 1, "aceitar");
  jogar(p, 0, 0); jogar(p, 1, 0); avancar(p);
  jogar(p, 0, 0); jogar(p, 1, 0); avancar(p);
  assert.equal(p.fase, "fim");
  assert.equal(p.vencedor, 0);
  assert.equal(p.pontos[0], 13);
});

teste("mão de onze: só o time com 11 decide; correr dá 1 ao outro, jogar vale 3 sem truco", () => {
  const p = novaPartida(2, ["A", "B"]);
  p.pontos = [11, 5];
  comecarMao(p);
  assert.equal(p.decisao11, 0);
  assert.equal(p.semAumento, true);
  assert.equal(jogar(p, 0, 0), false); // antes de decidir ninguém joga
  assert.equal(decidirOnze(p, 1, true), false);
  assert.ok(decidirOnze(p, 0, true));
  assert.equal(p.valor, 3);
  assert.equal(pedirAumento(p, p.vez), false);

  const q = novaPartida(2, ["A", "B"]);
  q.pontos = [4, 11];
  comecarMao(q);
  assert.equal(q.decisao11, 1);
  assert.ok(decidirOnze(q, 1, false));
  assert.deepEqual(q.pontos, [5, 11]);
  assert.equal(q.fase, "fimMao");
});

teste("mão de ferro (11 x 11): vale 1, sem truco e sem decisão", () => {
  const p = novaPartida(2, ["A", "B"]);
  p.pontos = [11, 11];
  comecarMao(p);
  assert.equal(p.decisao11, null);
  assert.equal(p.semAumento, true);
  assert.equal(p.valor, 1);
  assert.equal(pedirAumento(p, p.vez), false);
});

teste("quem corre da mão de onze pode fechar a partida do outro lado", () => {
  const p = novaPartida(2, ["A", "B"]);
  p.pontos = [11, 11];
  comecarMao(p);
  // 11x11: um vence a mão e a partida acaba
  const v = p.vez;
  p.maos[v] = [c("3", "P"), c("3", "C"), c("3", "E")];
  p.maos[1 - v] = [c("4", "O"), c("5", "O"), c("6", "O")];
  p.vira = c("7", "O");
  p.manilha = manilhaDe(p.vira);
  jogar(p, v, 0); jogar(p, 1 - v, 0); avancar(p);
  jogar(p, v, 0); jogar(p, 1 - v, 0); avancar(p);
  assert.equal(p.fase, "fim");
  assert.equal(p.pontos[v % 2], 12);
});

console.log(`\n${ok} testes passaram`);
