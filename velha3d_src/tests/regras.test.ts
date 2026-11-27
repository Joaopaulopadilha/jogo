import assert from "node:assert/strict";
import { LINHAS, jogar, novoEstado, vazias, type Estado, type Jogador } from "../src/regras.ts";
import { escolherJogada } from "../src/bot.ts";

let ok = 0;
function teste(nome: string, f: () => void): void {
  f();
  ok++;
  console.log("ok -", nome);
}

function semente(s: number): () => number {
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// monta uma posição jogando a sequência de casas, começando pelo X
function depois(...casas: number[]): Estado {
  const e = novoEstado(1);
  for (const i of casas) assert.ok(jogar(e, i, e.vez), "jogada inválida na montagem: " + i);
  return e;
}

teste("tabuleiro 3x3 com 8 linhas vencedoras", () => {
  assert.equal(novoEstado().cel.length, 9);
  assert.equal(LINHAS.length, 8);
  assert.equal(new Set(LINHAS.map((l) => l.join())).size, 8);
});

teste("cada uma das 8 linhas dá a vitória, para X e para O", () => {
  for (const l of LINHAS) {
    for (const quem of [1, 2] as Jogador[]) {
      const e = novoEstado(quem);
      const fora = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => !l.includes(i));
      // o outro joga em casas que não formam linha
      const deles = [fora[0], fora[1]];
      jogar(e, l[0], quem); jogar(e, deles[0], e.vez);
      jogar(e, l[1], quem); jogar(e, deles[1], e.vez);
      jogar(e, l[2], quem);
      assert.equal(e.fim, true);
      assert.equal(e.vencedor, quem);
      assert.deepEqual(e.linha, [...l]);
    }
  }
});

teste("jogadas inválidas são recusadas; depois do fim ninguém joga", () => {
  const e = novoEstado(1);
  assert.equal(jogar(e, 0, 2), false); // fora da vez
  assert.ok(jogar(e, 0, 1));
  assert.equal(jogar(e, 0, 2), false); // ocupada
  assert.equal(jogar(e, 9, 2), false);
  assert.equal(jogar(e, -1, 2), false);
  assert.equal(jogar(e, 1.5, 2), false);
  assert.equal(e.jogadas, 1);
  const g = depois(0, 3, 1, 4, 2);
  assert.equal(g.fim, true);
  assert.equal(jogar(g, 8, g.vez), false);
});

teste("deu velha", () => {
  const e = depois(0, 1, 2, 4, 3, 5, 7, 6, 8);
  assert.equal(e.fim, true);
  assert.equal(e.vencedor, 0);
  assert.equal(e.linha, null);
});

teste("vitória na última casa vale vitória, não empate", () => {
  const e = depois(0, 1, 4, 2, 5, 3, 7, 6, 8);
  assert.equal(e.vencedor, 1);
});

teste("computador sempre ganha quando pode (nos dois níveis)", () => {
  const e = depois(0, 3, 8, 4); // vez do X; o O tem 3,4 e ameaça o 5
  const g = depois(0, 3, 8, 4, 1); // vez do O: completa 3-4-5
  for (let s = 1; s <= 50; s++) {
    assert.equal(escolherJogada(g, 2, "normal", semente(s)), 5);
    assert.equal(escolherJogada(g, 2, "impossivel", semente(s)), 5);
    assert.equal(escolherJogada(e, 1, "impossivel", semente(s)), 5); // bloqueia
  }
});

// joga TODAS as partidas possíveis do adversário contra o computador impossível: ele nunca pode perder
teste("nível impossível nunca perde, contra qualquer sequência do adversário", () => {
  let partidas = 0;
  for (const bot of [1, 2] as Jogador[]) {
    for (let s = 1; s <= 3; s++) {
      const rnd = semente(s * 31 + bot);
      const explorar = (e: Estado): void => {
        if (e.fim) {
          partidas++;
          assert.ok(e.vencedor === 0 || e.vencedor === bot, "o computador perdeu: " + e.cel.join(""));
          return;
        }
        const copia = (): Estado => ({ ...e, cel: [...e.cel] });
        if (e.vez === bot) {
          const c = copia();
          assert.ok(jogar(c, escolherJogada(c, bot, "impossivel", rnd), bot));
          explorar(c);
        } else {
          for (const i of vazias(e)) { const c = copia(); jogar(c, i, c.vez); explorar(c); }
        }
      };
      explorar(novoEstado(1));
    }
  }
  console.log("     partidas exploradas:", partidas);
});

teste("nível normal dá para ganhar, mas costuma ir melhor que o acaso", () => {
  let vitorias = 0;
  let derrotas = 0;
  const total = 600;
  for (let s = 1; s <= total; s++) {
    const rnd = semente(s * 7);
    const e = novoEstado(s % 2 ? 1 : 2);
    while (!e.fim) {
      if (e.vez === 2) jogar(e, escolherJogada(e, 2, "normal", rnd), 2);
      else { const v = vazias(e); jogar(e, v[Math.floor(rnd() * v.length)], 1); }
    }
    if (e.vencedor === 2) vitorias++;
    else if (e.vencedor === 1) derrotas++;
  }
  console.log(`     contra jogadas ao acaso: ${vitorias} vitórias, ${derrotas} derrotas em ${total}`);
  assert.ok(vitorias > total * 0.6);
  assert.ok(derrotas > 0, "no nível normal tem que dar para ganhar");
});

console.log(`\n${ok} testes passaram`);
