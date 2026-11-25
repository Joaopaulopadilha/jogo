// Regras do Truco Paulista (baralho de 40 cartas, 2 jogadores ou 4 em duplas).
// Este arquivo não conhece rede nem tela: só o estado da partida e as jogadas. Quem manda é o anfitrião.

export type Naipe = "O" | "E" | "C" | "P"; // ouros, espadas, copas, paus
export interface Carta { r: string; n: Naipe }
export type Time = 0 | 1;

// da mais fraca para a mais forte (sem 8, 9 e 10)
export const ORDEM = "4567QJKA23";
export const NAIPES: Naipe[] = ["O", "E", "C", "P"];
// entre manilhas: paus (zap) > copas > espadas > ouros
const FORCA_NAIPE: Record<Naipe, number> = { O: 0, E: 1, C: 2, P: 3 };
export const SIMBOLO: Record<Naipe, string> = { O: "♦", E: "♠", C: "♥", P: "♣" };

export const PONTOS_PARTIDA = 12;
const ESCADA = [1, 3, 6, 9, 12];
export const GRITO: Record<number, string> = { 3: "TRUCO", 6: "SEIS", 9: "NOVE", 12: "DOZE" };

export type Fase = "jogando" | "vazaFechada" | "fimMao" | "fim";
export type Resultado = Time | -1; // -1 = empate

export interface Pedido { de: number; valor: number }
export interface JogadaMesa { seat: number; carta: Carta; coberta?: boolean } // coberta = jogada escondida (não vale nada)
export interface JogadaVista { seat: number; carta: Carta | null; coberta: boolean } // carta null = escondida de quem está olhando

export interface Partida {
  n: 2 | 4;
  nomes: string[];
  pontos: [number, number];
  dador: number;
  numMao: number;
  fase: Fase;
  vira: Carta;
  manilha: string;
  maos: Carta[][];
  vazaCartas: JogadaMesa[]; // cartas na mesa da vaza em andamento
  vazas: Resultado[]; // resultado de cada vaza já fechada
  ultimaVaza: { cartas: JogadaMesa[]; vencedor: number } | null; // para a tela mostrar a vaza antes de limpar
  iniciouVaza: number;
  lider: number; // quem abre a próxima vaza
  vez: number;
  valor: number; // quanto a mão vale agora (1, 3, 6, 9 ou 12)
  pedido: Pedido | null; // pedido de aumento esperando resposta
  ultimoAumento: Time | -1; // time que fez o último aumento aceito (não pode aumentar de novo em seguida)
  semAumento: boolean; // mão de onze / mão de ferro: ninguém pede truco
  decisao11: Time | null; // time com 11 pontos que ainda decide se joga ou corre
  vencedor: Time | -1;
  aviso: string; // frase curta do que acabou de acontecer
  avisoId: number;
  resumo: string; // como a mão terminou
}

export const timeDe = (seat: number): Time => (seat % 2) as Time;

export function baralho(): Carta[] {
  const b: Carta[] = [];
  for (const r of ORDEM) for (const n of NAIPES) b.push({ r, n });
  return b;
}

export function embaralhar<T>(a: T[], rnd: () => number = Math.random): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// a manilha é a carta seguinte à vira
export function manilhaDe(vira: Carta): string {
  return ORDEM[(ORDEM.indexOf(vira.r) + 1) % ORDEM.length];
}

export function forca(c: Carta, manilha: string): number {
  if (c.r === manilha) return 100 + FORCA_NAIPE[c.n];
  return ORDEM.indexOf(c.r);
}

// uma carta escondida perde de qualquer carta aberta e só empata com outra escondida
export function forcaJogada(j: JogadaMesa, manilha: string): number {
  return j.coberta ? -1 : forca(j.carta, manilha);
}

export function proxValor(valor: number): number {
  const i = ESCADA.indexOf(valor);
  return i >= 0 && i < ESCADA.length - 1 ? ESCADA[i + 1] : valor;
}

function avisar(p: Partida, texto: string): void {
  p.aviso = texto;
  p.avisoId++;
}

export function novaPartida(n: 2 | 4, nomes: string[], rnd: () => number = Math.random): Partida {
  const p: Partida = {
    n,
    nomes,
    pontos: [0, 0],
    dador: n - 1, // assim o primeiro a jogar é o assento 0
    numMao: 0,
    fase: "jogando",
    vira: { r: "4", n: "O" },
    manilha: "5",
    maos: [],
    vazaCartas: [],
    vazas: [],
    ultimaVaza: null,
    iniciouVaza: 0,
    lider: 0,
    vez: 0,
    valor: 1,
    pedido: null,
    ultimoAumento: -1,
    semAumento: false,
    decisao11: null,
    vencedor: -1,
    aviso: "",
    avisoId: 0,
    resumo: "",
  };
  comecarMao(p, rnd);
  return p;
}

export function comecarMao(p: Partida, rnd: () => number = Math.random): void {
  const b = embaralhar(baralho(), rnd);
  p.maos = [];
  for (let s = 0; s < p.n; s++) p.maos.push(b.splice(0, 3));
  p.vira = b[0];
  p.manilha = manilhaDe(p.vira);
  p.numMao++;
  p.fase = "jogando";
  p.vazaCartas = [];
  p.vazas = [];
  p.ultimaVaza = null;
  p.vez = (p.dador + 1) % p.n;
  p.iniciouVaza = p.vez;
  p.lider = p.vez;
  p.valor = 1;
  p.pedido = null;
  p.ultimoAumento = -1;
  p.resumo = "";
  const a = p.pontos[0] === 11;
  const b11 = p.pontos[1] === 11;
  p.semAumento = a || b11; // mão de onze e mão de ferro não têm truco
  p.decisao11 = a !== b11 ? (a ? 0 : 1) : null; // com os dois em 11 (mão de ferro) joga-se direto, valendo 1
  if (p.decisao11 !== null) avisar(p, `${nomeTime(p.decisao11)} está na mão de onze`);
  else if (a && b11) avisar(p, "Mão de ferro: valendo 1 ponto, sem truco");
}

export function proximaMao(p: Partida, rnd: () => number = Math.random): void {
  if (p.fase !== "fimMao") return;
  p.dador = (p.dador + 1) % p.n;
  comecarMao(p, rnd);
}

export function nomeTime(t: Time): string {
  return t === 0 ? "Time 1" : "Time 2";
}

// quem ganhou a mão, olhando só os resultados das vazas (undefined = ainda não dá para saber)
export function resolver(v: Resultado[]): Resultado | undefined {
  const w = [0, 0];
  for (const x of v) if (x >= 0) w[x]++;
  if (w[0] >= 2) return 0;
  if (w[1] >= 2) return 1;
  if (v.length < 2) return undefined;
  if (v.length === 2) {
    if (v[0] === -1 && v[1] === -1) return undefined; // empatou as duas: a terceira decide
    if (v[0] === -1) return v[1]; // empatou a primeira: ganha quem fez a segunda
    if (v[1] === -1) return v[0]; // empatou a segunda: ganha quem fez a primeira
    return undefined; // uma para cada: a terceira decide
  }
  if (v[2] !== -1) return v[2];
  return v[0] !== -1 ? v[0] : -1; // terceira empatou: vale a primeira; se tudo empatou, ninguém pontua
}

// ---------------- jogadas ----------------

export function podeAumentar(p: Partida, seat: number): boolean {
  return (
    p.fase === "jogando" &&
    p.pedido === null &&
    p.decisao11 === null &&
    !p.semAumento &&
    p.valor < 12 &&
    seat === p.vez &&
    timeDe(seat) !== p.ultimoAumento
  );
}

// coberta: joga a carta virada para baixo. Só vale da segunda vaza em diante.
export function jogar(p: Partida, seat: number, idx: number, coberta = false): boolean {
  if (p.fase !== "jogando" || p.pedido || p.decisao11 !== null || seat !== p.vez) return false;
  if (coberta && p.vazas.length === 0) return false;
  const mao = p.maos[seat];
  if (!Number.isInteger(idx) || idx < 0 || idx >= mao.length) return false;
  const [carta] = mao.splice(idx, 1);
  if (p.vazaCartas.length === 0) p.iniciouVaza = seat;
  p.vazaCartas.push(coberta ? { seat, carta, coberta: true } : { seat, carta });
  if (coberta) avisar(p, `${p.nomes[seat]} escondeu a carta`);
  if (p.vazaCartas.length < p.n) {
    p.vez = (seat + 1) % p.n;
    return true;
  }
  fecharVaza(p);
  return true;
}

function fecharVaza(p: Partida): void {
  const f = p.vazaCartas.map((j) => forcaJogada(j, p.manilha));
  const max = Math.max(...f);
  const topo = p.vazaCartas.filter((_, i) => f[i] === max);
  const times = new Set(topo.map((j) => timeDe(j.seat)));
  let vencedor = -1;
  let res: Resultado = -1;
  if (times.size === 1) {
    vencedor = topo[0].seat;
    res = timeDe(vencedor);
  }
  p.vazas.push(res);
  p.ultimaVaza = { cartas: [...p.vazaCartas], vencedor };
  p.lider = vencedor >= 0 ? vencedor : p.iniciouVaza; // empatou: quem abriu abre de novo
  p.fase = "vazaFechada";
  avisar(p, vencedor >= 0 ? `${p.nomes[vencedor]} levou a vaza` : "Vaza empatada (embuchou)");
}

// depois de mostrar a vaza fechada: limpa a mesa e segue (ou fecha a mão)
export function avancar(p: Partida): void {
  if (p.fase !== "vazaFechada") return;
  p.vazaCartas = [];
  const r = resolver(p.vazas);
  if (r === undefined) {
    p.vez = p.lider;
    p.fase = "jogando";
    return;
  }
  if (r === -1) encerrar(p, -1, 0, "Mão empatada: ninguém pontua");
  else encerrar(p, r, p.valor, `${nomeTime(r)} ganhou a mão (${p.valor} ${p.valor === 1 ? "ponto" : "pontos"})`);
}

function encerrar(p: Partida, time: Resultado, pontos: number, resumo: string): void {
  p.pedido = null;
  p.decisao11 = null;
  p.resumo = resumo;
  if (time !== -1) {
    p.pontos[time] += pontos;
    if (p.pontos[time] >= PONTOS_PARTIDA) {
      p.fase = "fim";
      p.vencedor = time;
      return;
    }
  }
  p.fase = "fimMao";
}

export function pedirAumento(p: Partida, seat: number): boolean {
  if (!podeAumentar(p, seat)) return false;
  const valor = proxValor(p.valor);
  p.pedido = { de: seat, valor };
  avisar(p, `${p.nomes[seat]}: ${GRITO[valor]}!`);
  return true;
}

export type Resposta = "aceitar" | "correr" | "aumentar";

export function responder(p: Partida, seat: number, acao: Resposta): boolean {
  const ped = p.pedido;
  if (!ped || p.fase !== "jogando") return false;
  if (timeDe(seat) === timeDe(ped.de)) return false; // só o time adversário responde
  if (acao === "correr") {
    avisar(p, `${p.nomes[seat]} correu`);
    encerrar(p, timeDe(ped.de), p.valor, `${p.nomes[seat]} correu: ${nomeTime(timeDe(ped.de))} leva ${p.valor} ${p.valor === 1 ? "ponto" : "pontos"}`);
    return true;
  }
  if (acao === "aceitar") {
    p.valor = ped.valor;
    p.ultimoAumento = timeDe(ped.de);
    p.pedido = null;
    avisar(p, `${p.nomes[seat]} aceitou: vale ${p.valor}`);
    return true;
  }
  if (acao === "aumentar") {
    if (ped.valor >= 12) return false;
    p.valor = ped.valor;
    p.ultimoAumento = timeDe(seat);
    const valor = proxValor(p.valor);
    p.pedido = { de: seat, valor };
    avisar(p, `${p.nomes[seat]}: ${GRITO[valor]}!`);
    return true;
  }
  return false;
}

export function decidirOnze(p: Partida, time: Time, jogarMao: boolean): boolean {
  if (p.decisao11 !== time || p.fase !== "jogando") return false;
  if (jogarMao) {
    p.decisao11 = null;
    p.valor = 3;
    avisar(p, `${nomeTime(time)} vai jogar a mão de onze (vale 3)`);
  } else {
    avisar(p, `${nomeTime(time)} correu da mão de onze`);
    encerrar(p, (1 - time) as Time, 1, `${nomeTime(time)} correu da mão de onze: ${nomeTime((1 - time) as Time)} leva 1 ponto`);
  }
  return true;
}

// ---------------- o que cada jogador enxerga ----------------

export interface Vista {
  t: "estado";
  n: 2 | 4;
  eu: number;
  nomes: string[];
  bots: boolean[];
  pontos: [number, number];
  numMao: number;
  dador: number;
  fase: Fase;
  vira: Carta;
  manilha: string;
  mao: Carta[];
  parceiro: Carta[] | null; // só na mão de onze, para a dupla que decide
  qtd: number[];
  mesa: JogadaVista[];
  vazas: Resultado[];
  ultimaVaza: { cartas: JogadaVista[]; vencedor: number } | null;
  vez: number;
  valor: number;
  pedido: Pedido | null;
  semAumento: boolean;
  decisao11: Time | null;
  podeTruco: boolean;
  podeEsconder: boolean;
  proxValor: number;
  podeAumentarResp: boolean;
  vencedor: Time | -1;
  aviso: string;
  avisoId: number;
  resumo: string;
}

export function vistaPara(p: Partida, seat: number, bots: boolean[]): Vista {
  const meuTime = timeDe(seat);
  const mostraParceiro = p.n === 4 && p.decisao11 === meuTime;
  // a carta escondida só o dono enxerga
  const ver = (j: JogadaMesa): JogadaVista => ({ seat: j.seat, carta: j.coberta && j.seat !== seat ? null : j.carta, coberta: !!j.coberta });
  return {
    t: "estado",
    n: p.n,
    eu: seat,
    nomes: p.nomes,
    bots,
    pontos: p.pontos,
    numMao: p.numMao,
    dador: p.dador,
    fase: p.fase,
    vira: p.vira,
    manilha: p.manilha,
    mao: p.maos[seat],
    parceiro: mostraParceiro ? p.maos[(seat + 2) % 4] : null,
    qtd: p.maos.map((m) => m.length),
    mesa: p.vazaCartas.map(ver),
    vazas: p.vazas,
    ultimaVaza: p.ultimaVaza ? { cartas: p.ultimaVaza.cartas.map(ver), vencedor: p.ultimaVaza.vencedor } : null,
    vez: p.vez,
    valor: p.valor,
    pedido: p.pedido,
    semAumento: p.semAumento,
    decisao11: p.decisao11,
    podeTruco: podeAumentar(p, seat),
    podeEsconder: p.fase === "jogando" && p.vez === seat && !p.pedido && p.decisao11 === null && p.vazas.length >= 1,
    proxValor: proxValor(p.valor),
    podeAumentarResp: !!p.pedido && p.pedido.valor < 12,
    vencedor: p.vencedor,
    aviso: p.aviso,
    avisoId: p.avisoId,
    resumo: p.resumo,
  };
}
