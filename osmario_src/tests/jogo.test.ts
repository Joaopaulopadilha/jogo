import assert from "node:assert/strict";
import { CHAO, LINHAS, TOTAL_FASES, montarFase } from "../src/fases.ts";
import { Jogo, T, TAMANHO, type Controles, type Heroi } from "../src/jogo.ts";

let ok = 0;
function teste(nome: string, f: () => void): void {
  f();
  ok++;
  console.log("ok -", nome);
}
const DT = 1 / 60;
const nada: Controles = { esquerda: false, direita: false, correr: false, pulo: false, fogo: false };
const roda = (j: Jogo, seg: number, c: Partial<Controles> = {}): string[] => {
  const ev: string[] = [];
  for (let i = 0; i < Math.round(seg / DT); i++) ev.push(...j.passo(DT, { ...nada, ...c }));
  return ev;
};
// fase lisa para testar a física
function plano(): Jogo {
  const j = new Jogo(0);
  for (let l = 0; l < LINHAS; l++) for (let c = 0; c < j.fase.largura; c++) j.fase.grade[l][c] = l >= CHAO ? "#" : " ";
  j.inimigos = [];
  return j;
}

teste("fases: mesmo tamanho de grade, chão no começo e na bandeira, inimigos sobre algo", () => {
  for (let i = 0; i < TOTAL_FASES; i++) {
    const f = montarFase(i);
    assert.equal(f.grade.length, LINHAS);
    assert.ok(f.grade.every((l) => l.length === f.largura));
    assert.equal(f.grade[CHAO][f.inicio], "#");
    assert.equal(f.grade[CHAO][f.chegada], "#");
    for (const n of f.inimigos) if (n.tipo === "barata") {
      assert.notEqual(f.grade[n.lin + 1][n.col], " ", `fase ${i + 1}: barata no ar na coluna ${n.col}`);
      assert.equal(f.grade[n.lin][n.col], " ", `fase ${i + 1}: barata dentro de bloco na coluna ${n.col}`);
    }
  }
});

teste("física: fica no chão, anda, corre mais rápido que anda e para por atrito", () => {
  const j = plano();
  roda(j, 0.5);
  assert.ok(j.h.noChao);
  assert.equal(Math.round(j.h.y + j.h.h), CHAO * T);
  const a = plano(); roda(a, 1, { direita: true });
  const b = plano(); roda(b, 1, { direita: true, correr: true });
  assert.ok(b.h.x > a.h.x + T);
  roda(a, 1);
  assert.equal(a.h.vx, 0);
});

teste("pulo: segurando vai mais alto que um toque", () => {
  const altura = (segurar: number): number => {
    const j = plano();
    roda(j, 0.1);
    const chao = j.h.y;
    let topo = chao;
    for (let i = 0; i < 120; i++) { j.passo(DT, { ...nada, pulo: i * DT < segurar }); topo = Math.min(topo, j.h.y); }
    assert.ok(j.h.noChao, "voltou ao chão");
    return chao - topo;
  };
  const curto = altura(0.05);
  const longo = altura(1);
  assert.ok(longo > 3.4 * T && longo < 4.2 * T, "pulo alto: " + longo);
  assert.ok(curto < longo * 0.65, "pulo curto: " + curto);
});

teste("pulo duplo: um pulo extra no ar, só um, e volta ao tocar o chão", () => {
  const j = plano();
  roda(j, 0.1);
  const chao = j.h.y;
  let topo = chao;
  const marca = (c: Partial<Controles>, seg: number): string[] => {
    const ev: string[] = [];
    for (let i = 0; i < Math.round(seg / DT); i++) { ev.push(...j.passo(DT, { ...nada, ...c })); topo = Math.min(topo, j.h.y); }
    return ev;
  };
  assert.deepEqual(marca({ pulo: true }, 0.38).filter((e) => e.startsWith("pulo")), ["pulo"]);
  marca({}, 0.02);
  assert.deepEqual(marca({ pulo: true }, 0.35).filter((e) => e.startsWith("pulo")), ["pulo2"]);
  marca({}, 0.02);
  assert.deepEqual(marca({ pulo: true }, 0.2).filter((e) => e.startsWith("pulo")), []); // não tem terceiro
  assert.ok(chao - topo > 5.5 * T, "pulo duplo alto: " + (chao - topo) / T);
  marca({}, 1.5);
  assert.ok(j.h.noChao);
  assert.deepEqual(marca({ pulo: true }, 0.2).filter((e) => e.startsWith("pulo")), ["pulo"]);
  marca({}, 0.02);
  assert.deepEqual(marca({ pulo: true }, 0.1).filter((e) => e.startsWith("pulo")), ["pulo2"]);
});

teste("saindo de uma beirada ainda dá para dar o pulo no ar", () => {
  const j = plano();
  j.h.y -= 3 * T;
  j.h.noChao = false;
  roda(j, 0.2);
  assert.ok(roda(j, 0.05, { pulo: true }).includes("pulo2"));
});

teste("foguinho: sai do bloco vermelho, faz crescer e dá o poder", () => {
  const j = plano();
  const col = j.fase.inicio;
  j.fase.grade[6][col] = "F";
  roda(j, 0.1);
  roda(j, 0.6, { pulo: true });
  assert.equal(j.fase.grade[6][col], "U");
  assert.equal(j.itens[0].tipo, "fogo");
  roda(j, 1);
  assert.equal(j.itens.length, 1); // fica parado esperando
  j.itens[0].x = j.h.x; j.itens[0].y = j.h.y;
  roda(j, 0.05);
  assert.equal(j.h.fogo, true);
  assert.equal(j.h.grande, true);
});

const bicho = (tipo: "barata" | "drone", x: number, y: number) => ({ tipo, x, y, w: tipo === "drone" ? 36 : 42, h: 28, vx: 0, vy: 0, baseX: x, baseY: y, t: 0, achatado: 0, ativo: false });

teste("tiro: sem o poder não atira; no chão quica e acerta a barata", () => {
  const j = plano();
  roda(j, 0.1);
  assert.ok(!roda(j, 0.1, { fogo: true }).includes("tiro"));
  j.h.fogo = true;
  roda(j, 0.05);
  j.inimigos = [bicho("barata", j.h.x + 5 * T, CHAO * T - 28)];
  const ev = roda(j, 0.05, { fogo: true }).concat(roda(j, 0.8));
  assert.ok(ev.includes("tiro"));
  assert.ok(ev.includes("pisao"), "a bola devia acertar a barata");
  assert.equal(j.tiros.length, 0);
});

teste("tiro no ar vai reto e acerta o drone", () => {
  const j = plano();
  roda(j, 0.1);
  j.h.fogo = true;
  roda(j, 0.25, { pulo: true });
  const ev = roda(j, DT, { fogo: true });
  const bola = j.tiros[0];
  assert.equal(bola.reto, true);
  const y0 = bola.y;
  // um drone 3 blocos à frente, na altura da bola (o balanço dele passa por essa altura quando ela chega)
  const drone = { ...bicho("drone", j.h.x + 3 * T, y0 - 6), baseY: y0 - 6, t: -0.2 };
  j.inimigos = [drone];
  ev.push(...roda(j, 0.1));
  assert.equal(j.tiros[0].y, y0); // não cai
  ev.push(...roda(j, 0.5));
  assert.ok(ev.includes("pisao"), "a bola devia acertar o drone");
});

teste("tiro: no máximo 3 de uma vez, um por aperto, e some na parede", () => {
  const j = plano();
  j.h.fogo = true;
  roda(j, 0.1);
  assert.equal(roda(j, 1, { fogo: true }).filter((e) => e === "tiro").length, 1); // segurando não metralha
  j.tiros = [];
  for (let i = 0; i < 6; i++) { roda(j, 0.3); roda(j, 0.02, { fogo: true }); assert.ok(j.tiros.length <= 3); }
  roda(j, 2);
  assert.equal(j.tiros.length, 0);
  j.fase.grade[9][j.fase.inicio + 2] = "#";
  j.fase.grade[8][j.fase.inicio + 2] = "#";
  roda(j, 0.02, { fogo: true });
  roda(j, 0.3);
  assert.equal(j.tiros.length, 0);
});

teste("dano com foguinho: perde o fogo, depois encolhe, depois morre; o poder vai para a próxima fase", () => {
  const j = plano();
  j.h.fogo = true; j.h.grande = true; j.h.h = TAMANHO.grande.h; j.h.y = CHAO * T - j.h.h;
  const ataque = (): string[] => { j.h.invencivel = 0; j.inimigos = [{ ...bicho("barata", j.h.x + 50, CHAO * T - 28), vx: -220, ativo: true }]; return roda(j, 0.3); };
  ataque();
  assert.deepEqual([j.h.fogo, j.h.grande], [false, true]);
  ataque();
  assert.deepEqual([j.h.fogo, j.h.grande], [false, false]);
  assert.ok(ataque().includes("morte"));

  const k = new Jogo(0);
  k.h.fogo = true; k.h.grande = true; k.h.h = TAMANHO.grande.h;
  k.estado = "venceuFase";
  k.proximaFase();
  assert.deepEqual([k.numero, k.h.fogo, k.h.grande], [1, true, true]);
  assert.equal(Math.round(k.h.y + k.h.h), CHAO * T);
});

teste("cada fase tem pelo menos um bloco de foguinho", () => {
  for (let i = 0; i < TOTAL_FASES; i++) assert.ok(montarFase(i).grade.flat().includes("F"), "fase " + (i + 1));
});

teste("bloco ?: dá moeda uma vez só; tijolo quebra apenas quando grande", () => {
  const j = plano();
  const col = j.fase.inicio;
  j.fase.grade[6][col] = "?";
  roda(j, 0.1);
  roda(j, 0.6, { pulo: true });
  assert.equal(j.moedas, 1);
  assert.equal(j.fase.grade[6][col], "U");
  roda(j, 0.6); roda(j, 0.6, { pulo: true });
  assert.equal(j.moedas, 1);

  const p = plano();
  p.fase.grade[6][p.fase.inicio] = "B";
  roda(p, 0.1); roda(p, 0.6, { pulo: true });
  assert.equal(p.fase.grade[6][p.fase.inicio], "B");
  const g = plano();
  g.fase.grade[6][g.fase.inicio] = "C";
  roda(g, 0.1); roda(g, 0.6, { pulo: true });
  assert.equal(g.itens.length, 1);
  g.itens[0].x = g.h.x; g.itens[0].y = g.h.y; g.itens[0].saindo = 0; // vai até a coxinha
  roda(g, 0.05);
  assert.equal(g.h.grande, true);
  assert.equal(g.h.h, TAMANHO.grande.h);
  g.fase.grade[6][g.fase.inicio] = "B";
  roda(g, 0.8); g.h.x = g.fase.inicio * T; roda(g, 0.6, { pulo: true });
  assert.equal(g.fase.grade[6][g.fase.inicio], " ");
});

teste("pisão mata a barata; bater de lado encolhe e depois tira vida", () => {
  const j = plano();
  j.fase.inimigos = [];
  const barata = { tipo: "barata" as const, x: j.h.x, y: CHAO * T - 28, w: 42, h: 28, vx: 0, vy: 0, baseX: 0, baseY: 0, t: 0, achatado: 0, ativo: true };
  j.h.y -= 2 * T; j.h.noChao = false;
  j.inimigos = [{ ...barata }];
  const ev = roda(j, 0.6);
  assert.ok(ev.includes("pisao"));
  assert.equal(j.pontos, 200);
  assert.equal(j.vidas, 3);

  const g = plano();
  g.h.grande = true; g.h.h = TAMANHO.grande.h; g.h.y = CHAO * T - g.h.h;
  g.inimigos = [{ ...barata, x: g.h.x + 60, vx: -200 }];
  assert.ok(roda(g, 0.4).includes("dano"));
  assert.equal(g.h.grande, false);
  assert.ok(g.h.invencivel > 0);
  roda(g, 2);
  g.inimigos = [{ ...barata, x: g.h.x + 60, vx: -200 }];
  assert.ok(roda(g, 0.4).includes("morte"));
  roda(g, 2);
  assert.equal(g.vidas, 2);
  assert.equal(g.estado, "jogando"); // recomeçou a fase
});

teste("cair no buraco custa uma vida; sem vidas é fim de jogo", () => {
  const j = plano();
  for (let k = 0; k < 3; k++) {
    for (let c = 0; c < j.fase.largura; c++) { j.fase.grade[CHAO][c] = " "; j.fase.grade[CHAO + 1][c] = " "; }
    roda(j, 3);
  }
  assert.equal(j.vidas, 0);
  assert.equal(j.estado, "fimDeJogo");
});

teste("bandeira: vence a fase, vai para a próxima e na última zera o jogo", () => {
  for (let i = 0; i < TOTAL_FASES; i++) {
    const j = new Jogo(i);
    j.inimigos = [];
    j.h.x = (j.fase.chegada - 1) * T;
    const ev = roda(j, 1, { direita: true });
    assert.ok(ev.includes("vitoria"));
    assert.equal(j.estado, i === TOTAL_FASES - 1 ? "zerou" : "venceuFase");
    j.proximaFase();
    if (i < TOTAL_FASES - 1) assert.equal(j.numero, i + 1);
  }
});

// procura um caminho do começo à bandeira usando o próprio motor (sem inimigos): prova que dá para passar cada fase
teste("todas as fases podem ser terminadas", () => {
  const acoes: Controles[] = [
    { direita: true, esquerda: false, correr: true, pulo: false, fogo: false },
    { direita: true, esquerda: false, correr: true, pulo: true, fogo: false },
    { direita: true, esquerda: false, correr: false, pulo: false, fogo: false },
    { direita: true, esquerda: false, correr: false, pulo: true, fogo: false },
    { direita: false, esquerda: false, correr: false, pulo: true, fogo: false },
    { direita: false, esquerda: false, correr: false, pulo: false, fogo: false },
    { direita: false, esquerda: true, correr: false, pulo: false, fogo: false },
    { direita: false, esquerda: true, correr: false, pulo: true, fogo: false },
  ];
  for (let i = 0; i < TOTAL_FASES; i++) {
    const j = new Jogo(i);
    const chave = (h: Heroi): string => `${Math.round(h.x / 16)},${Math.round(h.y / 16)},${Math.round(h.vx / 90)},${Math.round(h.vy / 200)},${h.noChao ? 1 : 0},${h.puloAntes ? 1 : 0},${h.pulosAr}`;
    const vistos = new Set<string>();
    // fila por distância já percorrida (os mais adiantados primeiro)
    const baldes: Heroi[][] = Array.from({ length: j.fase.largura + 2 }, () => []);
    baldes[j.fase.inicio].push({ ...j.h });
    let melhor = j.fase.inicio;
    let venceu = false;
    let n = 0;
    while (!venceu && n < 400000) {
      let b = melhor;
      while (b >= 0 && baldes[b].length === 0) b--;
      if (b < 0) break;
      const origem = baldes[b].pop()!;
      for (const a of acoes) {
        j.h = { ...origem };
        j.estado = "jogando";
        j.inimigos = [];
        j.itens = [];
        for (let k = 0; k < 8 && (j.estado as string) === "jogando"; k++) j.passo(DT, a);
        n++;
        const estado = j.estado as string;
        if (estado === "venceuFase" || estado === "zerou") { venceu = true; break; }
        if (estado !== "jogando") continue;
        const c = chave(j.h);
        if (vistos.has(c)) continue;
        vistos.add(c);
        const col = Math.floor(j.h.x / T);
        baldes[col].push({ ...j.h });
        melhor = Math.max(melhor, col);
      }
    }
    assert.ok(venceu, `fase ${i + 1} não tem caminho: o mais longe foi a coluna ${melhor} de ${j.fase.chegada}`);
    console.log(`     fase ${i + 1}: caminho encontrado (${n} tentativas)`);
  }
});

console.log(`\n${ok} testes passaram`);
