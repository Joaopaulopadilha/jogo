// Regras do Pife (pif-paf): dois baralhos, 9 cartas para cada um. Na vez: compra do monte ou pega o topo do lixo e
// descarta uma. "Bate" quem arrumar as 9 cartas em jogos de 3 ou mais:
//   - sequência: mesmo naipe, valores seguidos (o Ás vale antes do 2 ou depois do K);
//   - trinca: mesmo valor em naipes diferentes.
// Se o descarte de alguém completa a mão de outro jogador, ele pode pegar e bater mesmo fora da vez.
// Este arquivo não conhece rede nem tela.

export type Naipe = "O" | "E" | "C" | "P"; // ouros, espadas, copas, paus
export interface Carta { id: number; r: number; n: Naipe } // r: 1 (Ás) a 13 (K); id: única entre as 104

export const NAIPES: Naipe[] = ["O", "E", "C", "P"];
export const SIMBOLO: Record<Naipe, string> = { O: "♦", E: "♠", C: "♥", P: "♣" };
export const ROTULO = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const CARTAS_NA_MAO = 9;

export function baralhos(): Carta[] {
  const b: Carta[] = [];
  let id = 0;
  for (let copia = 0; copia < 2; copia++) for (const n of NAIPES) for (let r = 1; r <= 13; r++) b.push({ id: id++, r, n });
  return b;
}

export function embaralhar<T>(a: T[], rnd: () => number = Math.random): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- jogos (sequências e trincas) ----------------

export function ehTrinca(g: Carta[]): boolean {
  return g.length >= 3 && g.length <= 4 && g.every((c) => c.r === g[0].r) && new Set(g.map((c) => c.n)).size === g.length;
}

export function ehSequencia(g: Carta[]): boolean {
  if (g.length < 3 || g.length > 13 || !g.every((c) => c.n === g[0].n)) return false;
  const seguidos = (v: number[]): boolean => {
    v.sort((a, b) => a - b);
    return v.every((x, i) => i === 0 || x === v[i - 1] + 1);
  };
  const valores = g.map((c) => c.r);
  if (seguidos([...valores])) return true;
  return valores.includes(1) && seguidos(valores.map((r) => (r === 1 ? 14 : r))); // Ás depois do K
}

export const ehJogo = (g: Carta[]): boolean => ehTrinca(g) || ehSequencia(g);

export interface Arranjo {
  jogos: Carta[][]; // jogos prontos, sem repetir carta
  soltas: Carta[];
}

// a melhor maneira de separar a mão: o máximo de cartas dentro de jogos (empate: mais jogos).
// Com até 10 cartas dá para testar todos os subconjuntos.
export function melhorArranjo(cartas: Carta[]): Arranjo {
  const n = cartas.length;
  const validos: number[] = []; // máscaras de bits dos subconjuntos que são jogos
  for (let m = 0; m < 1 << n; m++) {
    const g: Carta[] = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) g.push(cartas[i]);
    if (g.length >= 3 && ehJogo(g)) validos.push(m);
  }
  const bits = (m: number): number => { let k = 0; for (; m; m &= m - 1) k++; return k; };
  const nota = new Map<number, number>([[0, 0]]); // máscara coberta -> cartas*100 + jogos
  const veio = new Map<number, [number, number]>(); // máscara -> [anterior, jogo usado]
  let melhor = 0;
  for (let m = 0; m < 1 << n; m++) {
    const atual = nota.get(m);
    if (atual === undefined) continue;
    if (atual > nota.get(melhor)!) melhor = m;
    for (const v of validos) {
      if (m & v) continue;
      const novo = m | v;
      const valor = atual + bits(v) * 100 + 1;
      if (valor > (nota.get(novo) ?? -1)) { nota.set(novo, valor); veio.set(novo, [m, v]); }
    }
  }
  const jogos: Carta[][] = [];
  let coberto = melhor;
  while (coberto) {
    const [antes, v] = veio.get(coberto)!;
    const g = cartas.filter((_, i) => v & (1 << i));
    // sequências em ordem (com o Ás no fim quando é Q-K-A)
    const asAlto = ehSequencia(g) && !ehTrinca(g) && g.some((c) => c.r === 13) && g.some((c) => c.r === 1);
    g.sort((a, b) => (asAlto && a.r === 1 ? 14 : a.r) - (asAlto && b.r === 1 ? 14 : b.r));
    jogos.push(g);
    coberto = antes;
  }
  return { jogos: jogos.reverse(), soltas: cartas.filter((_, i) => !(melhor & (1 << i))) };
}

// as 9 cartas formam jogos?
export function maoCompleta(cartas: Carta[]): Carta[][] | null {
  if (cartas.length !== CARTAS_NA_MAO) return null;
  const a = melhorArranjo(cartas);
  return a.soltas.length === 0 ? a.jogos : null;
}

// com 9 ou 10 cartas: dá para bater? Com 10, devolve também qual carta sobra (o descarte).
export function podeBaterCom(mao: Carta[]): { jogos: Carta[][]; sobra: Carta | null } | null {
  if (mao.length === CARTAS_NA_MAO) {
    const jogos = maoCompleta(mao);
    return jogos ? { jogos, sobra: null } : null;
  }
  if (mao.length !== CARTAS_NA_MAO + 1) return null;
  for (let i = 0; i < mao.length; i++) {
    const jogos = maoCompleta(mao.filter((_, k) => k !== i));
    if (jogos) return { jogos, sobra: mao[i] };
  }
  return null;
}

// ---------------- a partida ----------------

export type Fase = "comprar" | "descartar" | "oferta" | "fim";

export interface Partida {
  n: number;
  nomes: string[];
  maos: Carta[][];
  monte: Carta[];
  lixo: Carta[]; // o topo é o último
  vez: number;
  abriu: number; // quem começou a rodada
  fase: Fase;
  doLixo: number | null; // carta pega do lixo nesta vez (não pode voltar na mesma jogada)
  ofertas: number[]; // quem ainda pode bater com o descarte, em ordem
  vencedor: number; // -1 = ninguém ainda
  jogosVencedores: Carta[][] | null;
  rodada: number;
  vitorias: number[];
  aviso: string;
  avisoId: number;
}

function avisar(p: Partida, texto: string): void {
  p.aviso = texto;
  p.avisoId++;
}

export function novaPartida(n: number, nomes: string[], rnd: () => number = Math.random): Partida {
  const p: Partida = {
    n, nomes, maos: [], monte: [], lixo: [], vez: 0, abriu: n - 1, fase: "comprar", doLixo: null, ofertas: [],
    vencedor: -1, jogosVencedores: null, rodada: 0, vitorias: Array<number>(n).fill(0), aviso: "", avisoId: 0,
  };
  comecarRodada(p, rnd);
  return p;
}

export function comecarRodada(p: Partida, rnd: () => number = Math.random): void {
  const b = embaralhar(baralhos(), rnd);
  p.maos = [];
  for (let s = 0; s < p.n; s++) p.maos.push(b.splice(0, CARTAS_NA_MAO));
  p.lixo = [b.pop()!];
  p.monte = b;
  p.abriu = (p.abriu + 1) % p.n; // cada rodada começa um jogador adiante
  p.vez = p.abriu;
  p.fase = "comprar";
  p.doLixo = null;
  p.ofertas = [];
  p.vencedor = -1;
  p.jogosVencedores = null;
  p.rodada++;
  avisar(p, `Rodada ${p.rodada}: ${p.nomes[p.vez]} começa`);
}

// o monte acabou: o lixo (menos o topo) é embaralhado e volta a ser o monte
function reporMonte(p: Partida, rnd: () => number): void {
  if (p.monte.length > 0 || p.lixo.length <= 1) return;
  const topo = p.lixo.pop()!;
  p.monte = embaralhar(p.lixo, rnd);
  p.lixo = [topo];
  avisar(p, "O monte acabou: o lixo foi embaralhado");
}

export function comprar(p: Partida, seat: number, de: "monte" | "lixo", rnd: () => number = Math.random): boolean {
  if (p.fase !== "comprar" || seat !== p.vez) return false;
  if (de === "monte") {
    reporMonte(p, rnd);
    const c = p.monte.pop();
    if (!c) return false;
    p.maos[seat].push(c);
    p.doLixo = null;
    avisar(p, `${p.nomes[seat]} comprou do monte`);
  } else {
    const c = p.lixo.pop();
    if (!c) return false;
    p.maos[seat].push(c);
    p.doLixo = c.id;
    avisar(p, `${p.nomes[seat]} pegou o ${ROTULO[c.r]}${SIMBOLO[c.n]} do lixo`);
  }
  p.fase = "descartar";
  return true;
}

export function descartar(p: Partida, seat: number, id: number): boolean {
  if (p.fase !== "descartar" || seat !== p.vez) return false;
  if (id === p.doLixo) return false; // não devolve na mesma vez a carta que pegou do lixo
  const i = p.maos[seat].findIndex((c) => c.id === id);
  if (i < 0) return false;
  const [c] = p.maos[seat].splice(i, 1);
  p.lixo.push(c);
  p.doLixo = null;
  avisar(p, `${p.nomes[seat]} descartou ${ROTULO[c.r]}${SIMBOLO[c.n]}`);
  // alguém bate com esse descarte? (na ordem da mesa, a partir de quem joga depois)
  p.ofertas = [];
  for (let k = 1; k < p.n; k++) {
    const s = (seat + k) % p.n;
    if (podeBaterCom([...p.maos[s], c])) p.ofertas.push(s);
  }
  if (p.ofertas.length > 0) {
    p.vez = seat; // fica anotado quem descartou, para seguir a ordem se todos passarem
    p.fase = "oferta";
  } else passarVez(p, seat);
  return true;
}

function passarVez(p: Partida, de: number): void {
  p.vez = (de + 1) % p.n;
  p.fase = "comprar";
}

// resposta de quem pode bater com o descarte: bater ou deixar passar
export function responderOferta(p: Partida, seat: number, bater_: boolean): boolean {
  if (p.fase !== "oferta" || p.ofertas[0] !== seat) return false;
  if (bater_) {
    const c = p.lixo[p.lixo.length - 1];
    const r = podeBaterCom([...p.maos[seat], c]);
    if (!r) return false;
    p.lixo.pop();
    p.maos[seat].push(c);
    vencer(p, seat, r.jogos, r.sobra);
    return true;
  }
  p.ofertas.shift();
  if (p.ofertas.length === 0) passarVez(p, p.vez);
  return true;
}

// bate na própria vez (com a carta comprada, ou com a mão já pronta antes de comprar)
export function bater(p: Partida, seat: number): boolean {
  if (seat !== p.vez || (p.fase !== "comprar" && p.fase !== "descartar")) return false;
  const r = podeBaterCom(p.maos[seat]);
  if (!r) return false;
  vencer(p, seat, r.jogos, r.sobra);
  return true;
}

function vencer(p: Partida, seat: number, jogos: Carta[][], sobra: Carta | null): void {
  if (sobra) {
    p.maos[seat] = p.maos[seat].filter((c) => c.id !== sobra.id);
    p.lixo.push(sobra);
  }
  p.vencedor = seat;
  p.jogosVencedores = jogos;
  p.vitorias[seat]++;
  p.fase = "fim";
  p.ofertas = [];
  p.doLixo = null;
  avisar(p, `${p.nomes[seat]} BATEU!`);
}

// ---------------- o que cada jogador enxerga ----------------

export interface Vista {
  t: "estado";
  n: number;
  eu: number;
  nomes: string[];
  bots: boolean[];
  mao: Carta[];
  qtd: number[];
  noMonte: number;
  lixo: Carta | null; // só o topo
  vez: number;
  fase: Fase;
  doLixo: number | null;
  possoBater: boolean; // na minha vez
  ofertaPraMim: boolean; // posso bater com o descarte de outro
  alguemDecidindo: boolean;
  vencedor: number;
  jogos: Carta[][] | null; // os jogos de quem bateu
  rodada: number;
  vitorias: number[];
  aviso: string;
  avisoId: number;
}

export function vistaPara(p: Partida, seat: number, bots: boolean[]): Vista {
  const minhaVez = p.vez === seat && (p.fase === "comprar" || p.fase === "descartar");
  return {
    t: "estado",
    n: p.n,
    eu: seat,
    nomes: p.nomes,
    bots,
    mao: p.maos[seat],
    qtd: p.maos.map((m) => m.length),
    noMonte: p.monte.length,
    lixo: p.lixo[p.lixo.length - 1] ?? null,
    vez: p.vez,
    fase: p.fase,
    doLixo: p.vez === seat ? p.doLixo : null,
    possoBater: minhaVez && podeBaterCom(p.maos[seat]) !== null,
    ofertaPraMim: p.fase === "oferta" && p.ofertas[0] === seat,
    alguemDecidindo: p.fase === "oferta",
    vencedor: p.vencedor,
    jogos: p.jogosVencedores,
    rodada: p.rodada,
    vitorias: p.vitorias,
    aviso: p.aviso,
    avisoId: p.avisoId,
  };
}
