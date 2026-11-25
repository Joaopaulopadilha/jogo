import assert from "node:assert/strict";
import { Mesa, type Msg } from "../src/mesa.ts";
import type { Vista } from "../src/regras.ts";

// gerador com semente para as simulações serem repetíveis
function semente(s: number): () => number {
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function simular(n: 2 | 4, seed: number): { passos: number; pontos: [number, number]; maos: number } {
  const rnd = semente(seed);
  const vistas = new Map<string, Msg>();
  const mesa = new Mesa((uid, m) => vistas.set(uid, m), "h", rnd);
  mesa.entrar("h", "Humano", 0);
  let agora = 0;
  assert.ok(mesa.iniciar(n, agora));
  mesa.sair("h", agora); // o único humano some: os bots jogam todos os assentos depois da tolerância
  let passos = 0;
  while (mesa.p!.fase !== "fim") {
    agora += 20000;
    assert.ok(mesa.tick(agora), `travou na fase ${mesa.p!.fase}, pedido=${JSON.stringify(mesa.p!.pedido)}, d11=${mesa.p!.decisao11}`);
    const p = mesa.p!;
    // invariantes
    for (const m of p.maos) assert.ok(m.length <= 3);
    assert.ok(p.pontos[0] >= 0 && p.pontos[1] >= 0);
    assert.ok([1, 3, 6, 9, 12].includes(p.valor));
    const cartas = [...p.maos.flat(), ...p.vazaCartas.map((j) => j.carta), p.vira].map((c) => c.r + c.n);
    assert.equal(new Set(cartas).size, cartas.length, "carta repetida");
    if (++passos > 20000) assert.fail("partida não termina");
  }
  const p = mesa.p!;
  assert.ok(p.vencedor === 0 || p.vencedor === 1);
  assert.ok(p.pontos[p.vencedor] >= 12);
  assert.ok(p.pontos[1 - p.vencedor] < 12 + 0, "os dois passaram de 12");
  return { passos, pontos: [...p.pontos], maos: p.numMao };
}

let totalMaos = 0;
for (const n of [2, 4] as const) {
  for (let seed = 1; seed <= 400; seed++) totalMaos += simular(n, seed).maos;
}
console.log(`ok - 800 partidas só de bots terminam (${totalMaos} mãos jogadas)`);

// ninguém enxerga a mão dos outros
{
  const vistas = new Map<string, Vista & Msg>();
  const mesa = new Mesa((uid, m) => vistas.set(uid, m as Vista & Msg), "a", semente(7));
  mesa.entrar("a", "Ana", 0);
  mesa.entrar("b", "Beto", 0);
  assert.ok(mesa.iniciar(2, 0));
  const va = vistas.get("a")!;
  const vb = vistas.get("b")!;
  assert.equal(va.eu, 0);
  assert.equal(vb.eu, 1);
  assert.equal(va.mao.length, 3);
  assert.equal(vb.mao.length, 3);
  assert.deepEqual(va.qtd, [3, 3]);
  assert.equal(va.parceiro, null);
  const txt = JSON.stringify(va);
  for (const c of vb.mao) assert.ok(!txt.includes(JSON.stringify(c)) || JSON.stringify(va.mao).includes(JSON.stringify(c)) || JSON.stringify(va.vira) === JSON.stringify(c), "vista vazou a mão do outro");
  console.log("ok - a vista de cada jogador só traz a própria mão");
}

// jogadas inválidas e fora da vez são ignoradas
{
  const mesa = new Mesa(() => {}, "a", semente(3));
  mesa.entrar("a", "Ana", 0);
  mesa.entrar("b", "Beto", 0);
  mesa.iniciar(2, 0);
  const p = mesa.p!;
  const quemNaoJoga = p.vez === 0 ? "b" : "a";
  mesa.receber(quemNaoJoga, { t: "jogar", i: 0 }, 0);
  assert.equal(p.vazaCartas.length, 0);
  mesa.receber("intruso", { t: "jogar", i: 0 }, 0);
  mesa.receber(quemNaoJoga, { t: "iniciar", n: 4 }, 0);
  mesa.receber(quemNaoJoga, { t: "novo" }, 0);
  assert.equal(mesa.fase, "jogo");
  mesa.receber(p.vez === 0 ? "a" : "b", { t: "jogar", i: 9 }, 0);
  assert.equal(p.vazaCartas.length, 0);
  mesa.receber(p.vez === 0 ? "a" : "b", { t: "jogar", i: 0 }, 0);
  assert.equal(p.vazaCartas.length, 1);
  console.log("ok - mensagens inválidas ou fora da vez são ignoradas");
}

// sala: limite de jogadores, reconexão e recusa no meio da partida
{
  const recebidas: Msg[] = [];
  const mesa = new Mesa((uid, m) => { if (uid === "x") recebidas.push(m); }, "a", semente(5));
  for (const u of ["a", "b", "c", "d"]) assert.ok(mesa.entrar(u, u, 0));
  assert.equal(mesa.entrar("x", "x", 0), false); // quinta pessoa
  assert.equal(recebidas.at(-1)?.t, "cheia");
  assert.equal(mesa.iniciar(2, 0), false); // 4 humanos não cabem em 1x1
  assert.ok(mesa.iniciar(4, 0));
  assert.equal(mesa.entrar("x", "x", 0), false); // partida começou
  mesa.sair("c", 1000);
  assert.ok(mesa.entrar("c", "c", 2000)); // quem caiu volta ao mesmo lugar
  assert.equal(mesa.jogadores.find((j) => j.uid === "c")!.conectado, true);
  console.log("ok - sala: limite, reconexão e entrada no meio da partida");
}

// no 2x2 humano e parceiro bot, o time inteiro precisa de resposta de humano antes do bot responder
{
  const mesa = new Mesa(() => {}, "a", semente(11));
  mesa.entrar("a", "Ana", 0);
  mesa.iniciar(4, 0);
  const p = mesa.p!;
  // faz o bot adversário pedir truco no turno dele: força vez no assento 1 e pedido
  p.vez = 1;
  p.pedido = { de: 1, valor: 3 };
  assert.equal(mesa.tick(100000), false); // time da Ana tem humano: espera ela
  mesa.receber("a", { t: "resp", a: "aceitar" }, 100000);
  assert.equal(p.pedido, null);
  assert.equal(p.valor, 3);
  console.log("ok - bots esperam o humano responder o truco");
}

// sinais entre parceiros: o parceiro sempre vê, os adversários só às vezes, e só no 2x2
{
  const recebidas: Record<string, Msg[]> = { a: [], b: [], c: [], d: [] };
  const mesa = new Mesa((u, m) => { if (m.t === "sinal") recebidas[u]?.push(m); }, "a", semente(21));
  for (const u of ["a", "b", "c", "d"]) mesa.entrar(u, u, 0);
  assert.ok(mesa.iniciar(4, 0)); // a=0, b=1, c=2, d=3: a e c são parceiros
  mesa.receber("a", { t: "sinal", s: "piscar" }, 1000);
  assert.equal(recebidas.a.length, 1);
  assert.equal(recebidas.a[0].vis, "eu");
  assert.equal(recebidas.c.length, 1);
  assert.equal(recebidas.c[0].vis, "parceiro");
  assert.equal(recebidas.c[0].seat, 0);
  mesa.receber("a", { t: "sinal", s: "lingua" }, 1200); // rápido demais
  assert.equal(recebidas.c.length, 1);
  mesa.receber("a", { t: "sinal", s: "lingua" }, 3000);
  assert.equal(recebidas.c.length, 2);
  mesa.receber("a", { t: "sinal", s: "bomba" }, 9000); // sinal que não existe
  mesa.receber("intruso", { t: "sinal", s: "piscar" }, 9000);
  assert.equal(recebidas.c.length, 2);
  // os adversários pegam no flagra em cerca de 30% das vezes
  for (let i = 0; i < 400; i++) mesa.receber("a", { t: "sinal", s: "ombro" }, 20000 + i * 2000);
  assert.equal(recebidas.c.length, 402); // o parceiro nunca perde um sinal
  for (const adv of ["b", "d"]) {
    const flagras = recebidas[adv].filter((m) => m.vis === "flagra").length;
    assert.ok(flagras > 80 && flagras < 160, `flagras de ${adv}: ${flagras}`);
    assert.ok(recebidas[adv].every((m) => m.vis === "flagra"));
  }
  console.log("ok - sinais: parceiro sempre vê, adversário às vezes, com intervalo mínimo");
}

// no 1x1 não há parceiro: sinais são ignorados
{
  let recebeu = 0;
  const mesa = new Mesa((_u, m) => { if (m.t === "sinal") recebeu++; }, "a", semente(2));
  mesa.entrar("a", "Ana", 0);
  mesa.entrar("b", "Beto", 0);
  mesa.iniciar(2, 0);
  mesa.receber("a", { t: "sinal", s: "piscar" }, 5000);
  assert.equal(recebeu, 0);
  console.log("ok - sem sinais no 1x1");
}

// esconder a carta, vindo do cliente: só da 2ª vaza em diante
{
  const mesa = new Mesa(() => {}, "a", semente(9));
  mesa.entrar("a", "Ana", 0);
  mesa.entrar("b", "Beto", 0);
  mesa.iniciar(2, 0);
  const p = mesa.p!;
  const primeiro = p.vez === 0 ? "a" : "b";
  mesa.receber(primeiro, { t: "jogar", i: 0, c: true }, 0); // escondida na 1ª vaza: recusada
  assert.equal(p.vazaCartas.length, 0);
  mesa.receber(primeiro, { t: "jogar", i: 0 }, 0);
  assert.equal(p.vazaCartas.length, 1);
  assert.equal(p.vazaCartas[0].coberta, undefined);
  console.log("ok - esconder a carta é recusado na primeira vaza");
}
