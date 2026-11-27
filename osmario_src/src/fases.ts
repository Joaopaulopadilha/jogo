// As fases. Cada uma é uma grade de LINHAS linhas (0 = topo); o chão ocupa as duas de baixo.
//   '#' chão   'B' tijolo   '?' bloco de moeda   'C' bloco de coxinha   'F' bloco do foguinho   'U' bloco usado
//   '=' tábua  'P' cano     'o' moeda            ' ' vazio

export const LINHAS = 12;
export const CHAO = 10; // primeira linha do chão

export type TipoInimigo = "barata" | "drone";
export type Cenario = "la" | "wall" | "neon";
export interface Nasce { tipo: TipoInimigo; col: number; lin: number }

export interface Fase {
  nome: string;
  largura: number; // em blocos
  grade: string[][]; // grade[linha][coluna]
  inicio: number; // coluna onde o herói nasce
  chegada: number; // coluna da bandeira
  inimigos: Nasce[];
  cenario: Cenario;
}

class Obra {
  readonly f: Fase;
  constructor(nome: string, largura: number, cenario: Cenario) {
    this.f = { nome, largura, cenario, inicio: 2, chegada: largura - 8, inimigos: [], grade: Array.from({ length: LINHAS }, () => Array<string>(largura).fill(" ")) };
  }
  por(col: number, lin: number, c: string): this {
    if (col >= 0 && col < this.f.largura && lin >= 0 && lin < LINHAS) this.f.grade[lin][col] = c;
    return this;
  }
  chao(de: number, ate: number): this {
    for (let x = de; x <= ate; x++) for (let y = CHAO; y < LINHAS; y++) this.por(x, y, "#");
    return this;
  }
  // vários blocos lado a lado, um por letra ('.' pula)
  blocos(col: number, lin: number, letras: string): this {
    [...letras].forEach((c, i) => { if (c !== ".") this.por(col + i, lin, c); });
    return this;
  }
  moedas(col: number, lin: number, n: number): this {
    for (let i = 0; i < n; i++) this.por(col + i, lin, "o");
    return this;
  }
  tabua(col: number, lin: number, n: number): this {
    for (let i = 0; i < n; i++) this.por(col + i, lin, "=");
    return this;
  }
  cano(col: number, altura: number): this {
    for (let y = CHAO - altura; y < CHAO; y++) this.por(col, y, "P").por(col + 1, y, "P");
    return this;
  }
  // degraus de 1 até n de altura (sobe = para a direita fica mais alto)
  escada(col: number, n: number, sobe = true): this {
    for (let i = 0; i < n; i++) {
      const alt = sobe ? i + 1 : n - i;
      for (let k = 0; k < alt; k++) this.por(col + i, CHAO - 1 - k, "#");
    }
    return this;
  }
  barata(...cols: number[]): this {
    for (const col of cols) this.f.inimigos.push({ tipo: "barata", col, lin: CHAO - 1 });
    return this;
  }
  drone(col: number, lin: number): this {
    this.f.inimigos.push({ tipo: "drone", col, lin });
    return this;
  }
}

function fase1(): Fase {
  const o = new Obra("Los Angeles", 112, "la");
  o.chao(0, 30).chao(33, 58).chao(62, 111);
  o.blocos(9, 6, "?").blocos(14, 6, "BCB?B").moedas(15, 3, 3).barata(18);
  o.cano(24, 2).moedas(31, 7, 2);
  o.blocos(37, 6, "?.F.?").barata(40, 46);
  o.cano(50, 3).moedas(59, 6, 3);
  o.tabua(66, 7, 4).moedas(66, 5, 4).barata(72, 75);
  o.blocos(80, 6, "BB?BB").drone(86, 6);
  o.escada(92, 4).escada(98, 4, false).moedas(95, 3, 3);
  return o.f;
}

function fase2(): Fase {
  const o = new Obra("Wall Street", 128, "wall");
  o.chao(0, 18).chao(22, 34).chao(46, 62).chao(66, 70).chao(75, 90).chao(103, 127);
  o.blocos(8, 6, "?C?").barata(13);
  o.moedas(19, 6, 3).cano(27, 2).barata(31);
  o.tabua(37, 8, 2).tabua(41, 7, 2).moedas(37, 6, 2).moedas(41, 5, 2); // travessia 1
  o.blocos(50, 6, "BBBFBBB").moedas(50, 3, 7).barata(53, 58);
  o.drone(64, 7).moedas(63, 6, 2).drone(73, 6);
  o.cano(79, 3).barata(85).blocos(86, 6, "C");
  o.tabua(93, 8, 2).tabua(97, 7, 3).moedas(97, 5, 3).drone(96, 3); // travessia 2
  o.barata(108, 111).blocos(110, 6, "?B?").escada(115, 3);
  return o.f;
}

function fase3(): Fase {
  const o = new Obra("Neon City", 144, "neon");
  o.chao(0, 14).chao(18, 28).chao(32, 36).chao(50, 60).chao(64, 66).chao(70, 84).chao(97, 108).chao(122, 143);
  o.blocos(6, 6, "C.F").barata(11).moedas(15, 6, 3);
  o.cano(22, 2).drone(30, 6).moedas(29, 5, 3);
  o.tabua(39, 8, 2).tabua(43, 7, 2).tabua(47, 8, 2).moedas(43, 5, 2).drone(45, 4);
  o.blocos(53, 6, "?B?").barata(55, 58);
  o.moedas(61, 6, 3).drone(68, 5);
  o.cano(74, 3).barata(79, 82).blocos(79, 6, "BCB");
  o.tabua(87, 8, 2).tabua(91, 6, 2).tabua(94, 7, 1).moedas(91, 4, 2).drone(89, 4);
  o.barata(101, 104).escada(105, 4);
  o.tabua(111, 7, 2).tabua(115, 7, 2).tabua(119, 8, 2).moedas(111, 5, 2).moedas(115, 5, 2).drone(118, 4);
  o.barata(127, 130).blocos(128, 6, "??").escada(132, 3);
  return o.f;
}

export const TOTAL_FASES = 3;

// sempre uma cópia nova: os blocos mudam durante o jogo
export function montarFase(i: number): Fase {
  return [fase1, fase2, fase3][i]();
}
