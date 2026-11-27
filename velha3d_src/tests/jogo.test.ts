import assert from "node:assert/strict";
import { Jogo, type Msg, type Vista } from "../src/jogo.ts";

function semente(s: number): () => number {
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function caixa(): { enviar: (u: string, m: Msg) => void; ultima: Map<string, Vista>; avisos: Map<string, Msg[]> } {
  const ultima = new Map<string, Vista>();
  const avisos = new Map<string, Msg[]>();
  return {
    ultima,
    avisos,
    enviar: (u, m) => {
      if (m.t === "estado") ultima.set(u, m as unknown as Vista);
      else avisos.set(u, [...(avisos.get(u) ?? []), m]);
    },
  };
}

// dois jogadores no mesmo aparelho
{
  const c = caixa();
  const j = new Jogo("local", c.enviar, "eu", "Ana", "normal", semente(1));
  j.entrar("eu", "Ana", 0);
  assert.deepEqual(c.ultima.get("eu")!.meus, [1, 2]);
  assert.equal(c.ultima.get("eu")!.cel, "000000000");
  j.receber("eu", { t: "jogar", i: 4 }, 0);
  j.receber("eu", { t: "jogar", i: 4 }, 0); // ocupada
  j.receber("outro", { t: "jogar", i: 0 }, 0); // desconhecido
  assert.equal(c.ultima.get("eu")!.cel, "000010000");
  assert.equal(c.ultima.get("eu")!.vez, 2);
  console.log("ok - modo local: o mesmo aparelho joga pelos dois");
}

// contra o computador: ele responde sozinho, e abre a partida seguinte
{
  const c = caixa();
  const j = new Jogo("bot", c.enviar, "eu", "Ana", "impossivel", semente(3));
  j.entrar("eu", "Ana", 0);
  assert.equal(c.ultima.get("eu")!.nomes[1], "Computador");
  assert.equal(j.tick(100), false);
  j.receber("eu", { t: "jogar", i: 0 }, 100);
  assert.equal(j.tick(100), false); // ainda "pensando"
  assert.equal(j.tick(5000), true);
  assert.equal(c.ultima.get("eu")!.jogadas, 2);
  let agora = 5000;
  while (!c.ultima.get("eu")!.fim) {
    agora += 5000;
    j.tick(agora);
    const v = c.ultima.get("eu")!;
    if (!v.fim && v.vez === 1) j.receber("eu", { t: "jogar", i: v.cel.indexOf("0") }, agora);
  }
  j.receber("eu", { t: "revanche" }, agora);
  assert.equal(c.ultima.get("eu")!.vez, 2);
  j.receber("eu", { t: "jogar", i: 0 }, agora); // é a vez do computador: ignorado
  assert.equal(c.ultima.get("eu")!.jogadas, 0);
  assert.equal(j.tick(agora + 10000), true);
  console.log("ok - contra o computador: joga na vez dele e abre a revanche");
}

// online: espera o adversário, valida a vez, reconecta, placar e revanche
{
  const c = caixa();
  const j = new Jogo("online", c.enviar, "a", "Ana", "normal", semente(5));
  j.entrar("a", "Ana", 0);
  assert.equal(c.ultima.get("a")!.aguardando, true);
  j.receber("a", { t: "jogar", i: 0 }, 0); // sozinha: não vale
  assert.equal(c.ultima.get("a")!.jogadas, 0);
  assert.ok(j.entrar("b", "Beto", 0));
  assert.deepEqual(c.ultima.get("a")!.meus, [1]);
  assert.deepEqual(c.ultima.get("b")!.meus, [2]);
  assert.equal(j.entrar("c", "Caio", 0), false);
  assert.equal(c.avisos.get("c")![0].t, "cheia");
  j.receber("b", { t: "jogar", i: 0 }, 0); // não é a vez do Beto
  assert.equal(c.ultima.get("a")!.jogadas, 0);
  j.receber("a", { t: "jogar", i: 0 }, 0);
  j.sair("b");
  assert.deepEqual(c.ultima.get("a")!.off, [false, true]);
  assert.ok(j.entrar("b", "Beto", 0));
  assert.deepEqual(c.ultima.get("b")!.meus, [2]);
  j.receber("b", { t: "jogar", i: 3 }, 0);
  j.receber("a", { t: "jogar", i: 1 }, 0);
  j.receber("b", { t: "jogar", i: 4 }, 0);
  j.receber("a", { t: "jogar", i: 2 }, 0); // linha 0-1-2
  let v = c.ultima.get("b")!;
  assert.equal(v.vencedor, 1);
  assert.deepEqual(v.linha, [0, 1, 2]);
  assert.deepEqual(v.placar, [1, 0]);
  j.receber("b", { t: "revanche" }, 0);
  v = c.ultima.get("a")!;
  assert.equal(v.fim, false);
  assert.equal(v.vez, 2); // quem começa alterna
  assert.deepEqual(v.placar, [1, 0]);
  console.log("ok - online: espera adversário, valida a vez, reconecta, placar e revanche");
}
