import assert from "node:assert/strict";
import { Mesa, type Msg } from "../src/mesa.ts";
import { ehJogo, type Vista } from "../src/regras.ts";

function semente(s: number): () => number {
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// rodadas só de bots: sempre terminam, sem perder nem repetir carta, e quem bate bateu de verdade
{
  let totalAcoes = 0;
  let rodadas = 0;
  for (const n of [2, 3, 4]) {
    for (let seed = 1; seed <= 60; seed++) {
      const mesa = new Mesa(() => {}, "h", semente(seed * 13 + n));
      mesa.entrar("h", "Humano", 0);
      assert.ok(mesa.iniciar(n, 0));
      mesa.sair("h", 0);
      let agora = 0;
      let acoes = 0;
      while (mesa.p!.fase !== "fim") {
        agora += 30000;
        assert.ok(mesa.tick(agora), `travou na fase ${mesa.p!.fase}`);
        const p = mesa.p!;
        const ids = [...p.maos.flat(), ...p.monte, ...p.lixo].map((c) => c.id);
        assert.equal(ids.length, 104);
        assert.equal(new Set(ids).size, 104);
        assert.ok(++acoes < 4000, "rodada não termina");
      }
      const p = mesa.p!;
      assert.ok(p.vencedor >= 0 && p.vencedor < n);
      assert.equal(p.jogosVencedores!.flat().length, 9);
      assert.ok(p.jogosVencedores!.every(ehJogo));
      totalAcoes += acoes;
      rodadas++;
    }
  }
  console.log(`ok - ${rodadas} rodadas só de bots terminam com batida válida (média de ${Math.round(totalAcoes / rodadas)} ações)`);
}

// sala: limite de jogadores, número escolhido, reconexão, próxima rodada só pelo anfitrião
{
  const recebidas: Record<string, Msg[]> = {};
  const mesa = new Mesa((u, m) => { (recebidas[u] ??= []).push(m); }, "a", semente(4));
  for (const u of ["a", "b", "c"]) assert.ok(mesa.entrar(u, u, 0));
  assert.equal(mesa.iniciar(2, 0), false); // gente demais
  assert.equal(mesa.iniciar(5, 0), false);
  mesa.receber("b", { t: "iniciar", n: 3 }, 0); // só o anfitrião
  assert.equal(mesa.fase, "sala");
  mesa.receber("a", { t: "iniciar", n: 4 }, 0);
  assert.equal(mesa.fase, "jogo");
  const v = recebidas.a.at(-1) as unknown as Vista;
  assert.equal(v.n, 4);
  assert.deepEqual(v.bots, [false, false, false, true]);
  assert.equal(mesa.entrar("x", "x", 0), false);
  mesa.sair("c", 100);
  assert.ok(mesa.entrar("c", "c", 200));
  mesa.receber("a", { t: "proxima" }, 0); // rodada em andamento: ignorado
  assert.equal(mesa.p!.rodada, 1);
  mesa.p!.fase = "fim";
  mesa.receber("b", { t: "proxima" }, 0);
  assert.equal(mesa.p!.rodada, 1);
  mesa.receber("a", { t: "proxima" }, 0);
  assert.equal(mesa.p!.rodada, 2);
  console.log("ok - sala, assentos, reconexão e próxima rodada");
}

// humano conectado: os bots esperam a vez dele
{
  const mesa = new Mesa(() => {}, "a", semente(9));
  mesa.entrar("a", "Ana", 0);
  mesa.iniciar(3, 0);
  assert.equal(mesa.p!.vez, 0);
  assert.equal(mesa.tick(100000), false);
  mesa.receber("a", { t: "comprar", de: "monte" }, 100000);
  assert.equal(mesa.p!.maos[0].length, 10);
  mesa.receber("a", { t: "descartar", id: mesa.p!.maos[0][0].id }, 100000);
  if (mesa.p!.fase !== "oferta") assert.equal(mesa.p!.vez, 1);
  assert.equal(mesa.tick(200000), true);
  console.log("ok - os bots esperam o humano");
}

// chat geral: chega a todos da sala, na espera e na partida, com limites
{
  const rec: Record<string, Msg[]> = { a: [], b: [], c: [] };
  const mesa = new Mesa((u, m) => { if (m.t === "chat") rec[u]?.push(m); }, "a", semente(2));
  mesa.entrar("a", "Ana", 0);
  mesa.entrar("b", "Beto", 0);
  mesa.receber("a", { t: "chat", texto: "alguém aí?" }, 1000); // na sala de espera
  assert.equal(rec.b.at(-1)?.texto, "alguém aí?");
  assert.equal(rec.b.at(-1)?.nome, "Ana");
  assert.equal(rec.b.at(-1)?.meu, false);
  assert.equal(rec.a.at(-1)?.meu, true);
  mesa.entrar("c", "Caio", 0);
  mesa.iniciar(3, 0);
  mesa.receber("b", { t: "chat", texto: "boa sorte" }, 2000); // na partida
  for (const u of ["a", "b", "c"]) assert.equal(rec[u].at(-1)?.texto, "boa sorte");
  const antes = rec.a.length;
  mesa.receber("b", { t: "chat", texto: "rápido" }, 2100); // rápido demais
  mesa.receber("c", { t: "chat", texto: "  \n\t " }, 3000); // vazio
  mesa.receber("intruso", { t: "chat", texto: "oi" }, 3000);
  assert.equal(rec.a.length, antes);
  mesa.receber("c", { t: "chat", texto: "x".repeat(500) }, 4000);
  assert.equal(String(rec.a.at(-1)?.texto).length, 140);
  mesa.sair("c", 5000);
  const doC = rec.c.length;
  mesa.receber("a", { t: "chat", texto: "cadê o Caio?" }, 6000);
  assert.equal(rec.c.length, doC); // quem caiu não recebe
  assert.equal(rec.b.at(-1)?.texto, "cadê o Caio?");
  console.log("ok - chat geral: todos recebem, com limites");
}
