import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LOTES, Lote, alturaFundo, gerador } from "./mapa";
import { Bloco, caixa, circulo } from "./colisao";
import type { Terreno } from "./terreno";

// Comunidade no morro do sudoeste: casas de alvenaria com interior, janelas, porta, escada por fora e laje (com parapeito, caixa
// d'água, antena, varal e alguns puxadinhos), postes com fios, e o "fundo" da comunidade (casas só para enfeite, morro acima, que ninguém alcança). Tudo é gerado por código a partir dos lotes
// de mapa.ts (mesmos números para todos os jogadores) e fundido numa malha só, com a cor em cada vértice (uma chamada de desenho).
// As colisões são blocos (colisao.ts): paredes com vão de porta e janela, escada degrau a degrau, laje e parapeito.

const E = 0.22; // espessura das paredes
const PE = 2.6; // pé-direito: do piso à face de baixo da laje
const LAJE = 0.18; // espessura da laje
const TOPO = PE + LAJE; // altura do alto da laje
const DEGRAUS = 8;
const ALT_DEGRAU = TOPO / DEGRAUS; // 0,3475: menos que o degrau automático do operário (0,4)
const COMP_DEGRAU = 0.3;
const LARG_ESCADA = 0.9;
const ALICERCE = 2.5; // quanto as paredes e a escada descem abaixo do piso (o beco em volta é uma rampa)

// pinturas das casas (e a faixa de baixo, mais escura): as 6 primeiras são tijolo à vista (a cor só tinge a textura), o resto é reboco pintado
const NUM_TIJOLO = 6;
const PINTURAS: [number, number][] = [
  [0xffffff, 0xb8998a],
  [0xf3d9c9, 0xa98370],
  [0xe6bfa6, 0x9a6f5a],
  [0xffe8d6, 0xb59582],
  [0xf6cfbd, 0xa5806c],
  [0xdcb29a, 0x94705c],
  [0xe6d08a, 0xb89c4d], // amarelo
  [0x7ec2b0, 0x4e8f80], // verde água
  [0xd9808f, 0xa04b5b], // rosa
  [0x8db4de, 0x5a86b5], // azul claro
];
const TIJOLOS = new Set<number>(PINTURAS.slice(0, NUM_TIJOLO).flat());
const PISOS = [0xcfc6b4, 0xb9b2a2, 0xd9cdb0, 0xa8b0a8];
const REBOCOS = new Set<number>([...PINTURAS.slice(NUM_TIJOLO).flat(), 0xa8a69e, 0xbfbcb3]);
const CONCRETO = 0xa8a69e;
const CONCRETO_CLARO = 0xbfbcb3;
const VIDRO = 0x1d2a35;
const MOLDURA = 0xe8e6df;
const FERRO = 0x3a3d42;
const FERRUGEM = 0x8a4a28;
const MADEIRA = 0x7a5233;
const PORTA_COR = [0x2c6fbb, 0x7a5233, 0x3f7d4e, 0xb03a2e];

// ---------------------------------------------------------------- texturas (desenhadas na hora): tijolo à vista e reboco manchado
type Modo = "liso" | "tijolo" | "reboco";
const ESCALA: Record<Modo, number> = { liso: 1, tijolo: 1.6, reboco: 2 }; // metros que a textura cobre

let texturas: Record<"tijolo" | "reboco", THREE.CanvasTexture> | null = null;
function criarTexturas(): Record<"tijolo" | "reboco", THREE.CanvasTexture> {
  if (texturas) return texturas;
  const rnd = gerador(31337);
  const tela = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    return [c, c.getContext("2d")!];
  };
  // manchas de umidade escorrendo (vertical), parecidas com as da foto
  const manchas = (g: CanvasRenderingContext2D, n: number): void => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * 256;
      const larg = 6 + rnd() * 22;
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "rgba(20,15,10,0)");
      grad.addColorStop(0.3 + rnd() * 0.4, `rgba(20,15,10,${0.05 + rnd() * 0.1})`);
      grad.addColorStop(1, "rgba(20,15,10,0)");
      g.fillStyle = grad;
      g.fillRect(x, 0, larg, 256);
      if (x + larg > 256) g.fillRect(x - 256, 0, larg, 256); // emenda
    }
  };
  const [ct, gt] = tela();
  gt.fillStyle = "#c9bca7"; // argamassa
  gt.fillRect(0, 0, 256, 256);
  const LINHA = 16;
  const TIJ = 42;
  for (let r = 0; r < 256 / LINHA; r++) {
    const desloc = r % 2 ? TIJ / 2 : 0;
    for (let x = -TIJ; x < 256 + TIJ; x += TIJ) {
      gt.fillStyle = `hsl(${8 + rnd() * 10}, ${42 + rnd() * 22}%, ${36 + rnd() * 20}%)`;
      gt.fillRect(x + desloc + 1.5, r * LINHA + 1.5, TIJ - 3, LINHA - 3);
    }
  }
  manchas(gt, 14);
  const [cr, gr] = tela();
  gr.fillStyle = "#ece8e0";
  gr.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = Math.floor(150 + rnd() * 100);
    gr.fillStyle = `rgba(${v},${v - 3},${v - 8},0.35)`;
    gr.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 5, 1 + rnd() * 5);
  }
  manchas(gr, 18);
  const tex = (c: HTMLCanvasElement): THREE.CanvasTexture => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  texturas = { tijolo: tex(ct), reboco: tex(cr) };
  return texturas;
}

// ---------------------------------------------------------------- malha de caixas com cor por vértice (uma malha por textura)
class Malha {
  private readonly geos: Record<Modo, THREE.BufferGeometry[]> = { liso: [], tijolo: [], reboco: [] };
  private readonly cor = new THREE.Color();
  private readonly rnd = gerador(777);

  private pintar(g: THREE.BufferGeometry, cor: number, modo: Modo = "liso"): void {
    const n = g.attributes.position.count;
    const v = new Float32Array(n * 3);
    this.cor.setHex(cor);
    const brilho = 0.94 + this.rnd() * 0.12; // um pouco de variação entre as peças
    for (let i = 0; i < n; i++) {
      v[i * 3] = this.cor.r * brilho;
      v[i * 3 + 1] = this.cor.g * brilho;
      v[i * 3 + 2] = this.cor.b * brilho;
    }
    g.setAttribute("color", new THREE.BufferAttribute(v, 3));
    this.geos[modo].push(g);
  }

  // caixa com centro (cx, cy, cz) e tamanho (sx, sy, sz), girada em y
  caixa(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, cor: number, rotY = 0): void {
    if (sx < 0.001 || sy < 0.001 || sz < 0.001) return;
    const g = new THREE.BoxGeometry(sx, sy, sz);
    const modo: Modo = TIJOLOS.has(cor) ? "tijolo" : REBOCOS.has(cor) ? "reboco" : "liso";
    if (modo !== "liso") {
      // a textura tem tamanho real em metros, não importa o tamanho da peça (6 faces, 4 vértices cada)
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const dim = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
      const ox = this.rnd();
      const oy = this.rnd();
      for (let i = 0; i < 24; i++) {
        const [du, dv] = dim[Math.floor(i / 4)];
        uv.setXY(i, (uv.getX(i) * du) / ESCALA[modo] + ox, (uv.getY(i) * dv) / ESCALA[modo] + oy);
      }
    }
    if (rotY) g.rotateY(rotY);
    g.translate(cx, cy, cz);
    this.pintar(g, cor, modo);
  }

  // caixa pelos limites em cada eixo
  faixa(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, cor: number): void {
    this.caixa((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, cor);
  }

  // barra fina entre dois pontos (corrimão, fio, haste)
  barra(a: THREE.Vector3, b: THREE.Vector3, esp: number, cor: number): void {
    const dir = b.clone().sub(a);
    const comp = dir.length();
    if (comp < 0.001) return;
    const g = new THREE.BoxGeometry(esp, esp, comp);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    this.pintar(g, cor);
  }

  cilindro(cx: number, cy: number, cz: number, raio: number, alt: number, cor: number, seg = 14): void {
    const g = new THREE.CylinderGeometry(raio, raio, alt, seg);
    g.translate(cx, cy, cz);
    this.pintar(g, cor);
  }

  construir(sombra = true): THREE.Group {
    const grupo = new THREE.Group();
    const tex = criarTexturas();
    for (const modo of ["liso", "tijolo", "reboco"] as Modo[]) {
      const lista = this.geos[modo];
      if (lista.length === 0) continue;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, map: modo === "liso" ? null : tex[modo] });
      const m = new THREE.Mesh(mergeGeometries(lista, false), mat);
      m.castShadow = sombra;
      m.receiveShadow = sombra;
      grupo.add(m);
      for (const g of lista) g.dispose();
    }
    return grupo;
  }
}

interface Ctx {
  m: Malha;
  blocos: Bloco[];
}

// peça (visual + bloco de colisão) pelos limites
function peca(c: Ctx, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, cor: number, colide = true, escalavel = true): void {
  if (x1 - x0 < 0.005 || y1 - y0 < 0.005 || z1 - z0 < 0.005) return;
  c.m.faixa(x0, x1, y0, y1, z0, z1, cor);
  if (colide) c.blocos.push(caixa((x0 + x1) / 2, (z0 + z1) / 2, 0, (x1 - x0) / 2, (z1 - z0) / 2, y0, y1, escalavel));
}

interface Abertura {
  c: number; // centro ao longo da parede
  l: number; // largura
  y0: number;
  y1: number;
  tipo: "porta" | "janela";
}

// parede reta (eixo "x": corre em x, parada em z = fixo; eixo "z": ao contrário) com vãos de porta e janela.
// fora = sentido (±1) para fora da casa no outro eixo (para a folha da porta abrir para fora)
function parede(c: Ctx, eixo: "x" | "z", fixo: number, ini: number, fim: number, esp: number, y0: number, y1: number, ab: Abertura[], cor: number, corBase: number, fora: number, alicerce = 0): void {
  const lista = [...ab].sort((a, b) => a.c - b.c);
  const trecho = (a: number, b: number, ya: number, yb: number): void => {
    if (b - a < 0.01 || yb - ya < 0.01) return;
    const base = ya <= y0 + 0.001 ? ya - alicerce : ya; // a parede continua para baixo (alicerce), para não flutuar onde o chão desce
    if (eixo === "x") peca(c, a, b, base, yb, fixo - esp / 2, fixo + esp / 2, cor);
    else peca(c, fixo - esp / 2, fixo + esp / 2, base, yb, a, b, cor);
    if (ya <= y0 + 0.001) {
      // faixa de baixo (rodapé pintado mais escuro), só visual
      const h = Math.min(0.55, yb - ya);
      if (eixo === "x") c.m.faixa(a, b, ya, ya + h, fixo - esp / 2 - 0.015, fixo + esp / 2 + 0.015, corBase);
      else c.m.faixa(fixo - esp / 2 - 0.015, fixo + esp / 2 + 0.015, ya, ya + h, a, b, corBase);
    }
  };
  let cursor = ini;
  for (const v of lista) {
    const o = { ...v, y0: y0 + v.y0, y1: y0 + v.y1 }; // as alturas do vão são contadas a partir da base da parede
    const a = o.c - o.l / 2;
    const b = o.c + o.l / 2;
    trecho(cursor, a, y0, y1);
    trecho(a, b, y0, o.y0); // peitoril
    trecho(a, b, o.y1, y1); // verga
    cursor = b;
    const ym = (o.y0 + o.y1) / 2;
    const h = o.y1 - o.y0;
    if (o.tipo === "janela") {
      // vidro escuro, moldura e grade
      if (eixo === "x") {
        c.m.caixa(o.c, ym, fixo, o.l - 0.1, h - 0.1, 0.04, VIDRO);
        c.m.caixa(o.c, o.y1 - 0.025, fixo, o.l, 0.05, esp + 0.04, MOLDURA);
        c.m.caixa(o.c, o.y0 + 0.025, fixo, o.l, 0.05, esp + 0.06, MOLDURA);
        for (let n = 1; n < 5; n++) c.m.caixa(o.c - o.l / 2 + (n * o.l) / 5, ym, fixo + fora * (esp / 2 + 0.03), 0.025, h, 0.025, FERRO);
      } else {
        c.m.caixa(fixo, ym, o.c, 0.04, h - 0.1, o.l - 0.1, VIDRO);
        c.m.caixa(fixo, o.y1 - 0.025, o.c, esp + 0.04, 0.05, o.l, MOLDURA);
        c.m.caixa(fixo, o.y0 + 0.025, o.c, esp + 0.06, 0.05, o.l, MOLDURA);
        for (let n = 1; n < 5; n++) c.m.caixa(fixo + fora * (esp / 2 + 0.03), ym, o.c - o.l / 2 + (n * o.l) / 5, 0.025, h, 0.025, FERRO);
      }
    } else {
      // porta: batentes e folha aberta para fora, encostada na parede
      const cor = PORTA_COR[Math.floor(Math.abs(o.c * 7.3) % PORTA_COR.length)];
      if (eixo === "x") {
        c.m.caixa(a - 0.03, ym, fixo, 0.06, h, esp + 0.04, MOLDURA);
        c.m.caixa(b + 0.03, ym, fixo, 0.06, h, esp + 0.04, MOLDURA);
        c.m.caixa(o.c, o.y1 + 0.03, fixo, o.l + 0.12, 0.06, esp + 0.04, MOLDURA);
        c.m.caixa(a + 0.03, ym, fixo + fora * (esp / 2 + 0.45), 0.05, h - 0.06, o.l - 0.1, cor);
      } else {
        c.m.caixa(fixo, ym, a - 0.03, esp + 0.04, h, 0.06, MOLDURA);
        c.m.caixa(fixo, ym, b + 0.03, esp + 0.04, h, 0.06, MOLDURA);
        c.m.caixa(fixo, o.y1 + 0.03, o.c, esp + 0.04, 0.06, o.l + 0.12, MOLDURA);
        c.m.caixa(fixo + fora * (esp / 2 + 0.45), ym, a + 0.03, o.l - 0.1, h - 0.06, 0.05, cor);
      }
    }
  }
  trecho(cursor, fim, y0, y1);
}

// parapeito baixo em volta de uma laje; `vaos` = trechos sem parapeito por lado ("N","S","L","O": [de, até] ao longo do lado)
function parapeito(c: Ctx, x0: number, x1: number, z0: number, z1: number, y: number, alt: number, cor: number, vaos: Partial<Record<string, [number, number]>>): void {
  const esp = 0.14;
  const lado = (nome: string, a: number, b: number, fixo: number, eixo: "x" | "z"): void => {
    const v = vaos[nome];
    const partes: [number, number][] = v ? [[a, Math.max(a, v[0])], [Math.min(b, v[1]), b]] : [[a, b]];
    for (const [p, q] of partes) {
      if (q - p < 0.05) continue;
      if (eixo === "x") peca(c, p, q, y, y + alt, fixo, fixo + esp, cor, true, true);
      else peca(c, fixo, fixo + esp, y, y + alt, p, q, cor, true, true);
    }
  };
  lado("N", x0, x1, z0, "x");
  lado("S", x0, x1, z1 - esp, "x");
  lado("O", z0 + esp, z1 - esp, x0, "z");
  lado("L", z0 + esp, z1 - esp, x1 - esp, "z");
}

// ---------------------------------------------------------------- a casa
function casa(c: Ctx, l: Lote): void {
  const rnd = gerador(l.semente);
  const { x, z, w, d, nivel: n0 } = l;
  const xa = x - w / 2;
  const xb = x + w / 2;
  const za = z - d / 2;
  const zb = z + d / 2;
  const [cor, corBase] = PINTURAS[l.cor];
  const piso = PISOS[Math.floor(rnd() * PISOS.length)];

  // piso e degrau da porta
  c.m.faixa(xa - E / 2, xb + E / 2, n0, n0 + 0.05, za - E / 2, zb + E / 2, piso);

  // paredes: cada vão de porta (uma por casa) e de janela
  const porta: Abertura = { c: 0, l: 0.95, y0: 0, y1: 2.1, tipo: "porta" };
  const jan = (cc: number): Abertura => ({ c: cc, l: 1.0, y0: 0.95, y1: 1.95, tipo: "janela" });
  const abN: Abertura[] = [];
  const abS: Abertura[] = [];
  const abL: Abertura[] = [];
  const abO: Abertura[] = [];
  if (l.porta === "L") {
    abL.push({ ...porta, c: za + d * 0.3 }, jan(za + d * 0.75));
    abN.push(jan(x));
    abO.push(jan(z));
  } else {
    abN.push({ ...porta, c: xa + w * 0.7 }, jan(xa + w * 0.25));
    abL.push(jan(z));
    abS.push(jan(x));
  }
  const y1 = n0 + PE;
  parede(c, "x", za, xa - E / 2, xb + E / 2, E, n0, y1, abN, cor, corBase, -1, ALICERCE);
  parede(c, "x", zb, xa - E / 2, xb + E / 2, E, n0, y1, abS, cor, corBase, 1, ALICERCE);
  parede(c, "z", xa, za + E / 2, zb - E / 2, E, n0, y1, abO, cor, corBase, -1, ALICERCE);
  parede(c, "z", xb, za + E / 2, zb - E / 2, E, n0, y1, abL, cor, corBase, 1, ALICERCE);

  // divisória entre a sala (frente) e o quarto (fundo), com uma passagem
  const ep = 0.14;
  if (l.porta === "L") {
    const xm = xb - w * 0.5;
    parede(c, "z", xm, za + E / 2, zb - E / 2, ep, n0, y1, [{ c: z + d * 0.2, l: 0.9, y0: 0, y1: 2.0, tipo: "porta" }], cor, corBase, -1);
  } else {
    const zm = za + d * 0.5;
    parede(c, "x", zm, xa + E / 2, xb - E / 2, ep, n0, y1, [{ c: x - w * 0.2, l: 0.9, y0: 0, y1: 2.0, tipo: "porta" }], cor, corBase, 1);
  }

  // laje (também é o teto): bloco em y de PE a TOPO
  const lx0 = xa - E / 2 - 0.15;
  const lx1 = xb + E / 2 + 0.15;
  const lz0 = za - E / 2 - 0.15;
  const lz1 = zb + E / 2 + 0.15;
  peca(c, lx0, lx1, n0 + PE, n0 + TOPO, lz0, lz1, CONCRETO);
  c.m.faixa(lx0 - 0.02, lx1 + 0.02, n0 + PE - 0.12, n0 + PE, lz0 - 0.02, lz1 + 0.02, CONCRETO_CLARO); // viga de borda

  // escada por fora até a laje (degrau a degrau); o parapeito abre onde ela chega
  const topo = n0 + TOPO;
  const vaos: Partial<Record<string, [number, number]>> = {};
  if (l.escada === "S") {
    const xs = xb - 0.1;
    const zc = zb + E / 2 + LARG_ESCADA / 2;
    for (let k = 0; k < DEGRAUS; k++) {
      const xc = xs - COMP_DEGRAU / 2 - k * COMP_DEGRAU;
      peca(c, xc - COMP_DEGRAU / 2, xc + COMP_DEGRAU / 2, n0 - ALICERCE, n0 + (k + 1) * ALT_DEGRAU, zc - LARG_ESCADA / 2, zc + LARG_ESCADA / 2, k % 2 ? CONCRETO : CONCRETO_CLARO);
    }
    const xf = xs - DEGRAUS * COMP_DEGRAU;
    c.m.barra(new THREE.Vector3(xs, n0 + 0.95, zc + LARG_ESCADA / 2 - 0.03), new THREE.Vector3(xf, topo + 0.95, zc + LARG_ESCADA / 2 - 0.03), 0.05, FERRO);
    for (const k of [0, 3, 7]) c.m.caixa(xs - COMP_DEGRAU / 2 - k * COMP_DEGRAU, n0 + (k + 1) * ALT_DEGRAU + 0.45, zc + LARG_ESCADA / 2 - 0.03, 0.05, 0.9, 0.05, FERRO);
    vaos.S = [xf - 0.1, xs + 0.1];
  } else {
    const xc = xa - E / 2 - LARG_ESCADA / 2;
    const zs = za + 0.1;
    for (let k = 0; k < DEGRAUS; k++) {
      const zk = zs + COMP_DEGRAU / 2 + k * COMP_DEGRAU;
      peca(c, xc - LARG_ESCADA / 2, xc + LARG_ESCADA / 2, n0 - ALICERCE, n0 + (k + 1) * ALT_DEGRAU, zk - COMP_DEGRAU / 2, zk + COMP_DEGRAU / 2, k % 2 ? CONCRETO : CONCRETO_CLARO);
    }
    const zf = zs + DEGRAUS * COMP_DEGRAU;
    c.m.barra(new THREE.Vector3(xc - LARG_ESCADA / 2 + 0.03, n0 + 0.95, zs), new THREE.Vector3(xc - LARG_ESCADA / 2 + 0.03, topo + 0.95, zf), 0.05, FERRO);
    for (const k of [0, 3, 7]) c.m.caixa(xc - LARG_ESCADA / 2 + 0.03, n0 + (k + 1) * ALT_DEGRAU + 0.45, zs + COMP_DEGRAU / 2 + k * COMP_DEGRAU, 0.05, 0.9, 0.05, FERRO);
    vaos.O = [zs - 0.1, zf + 0.1];
  }
  parapeito(c, lx0, lx1, lz0, lz1, topo, 0.75, CONCRETO_CLARO, vaos);

  // degrau da porta
  if (l.porta === "L") peca(c, xb + E / 2, xb + E / 2 + 0.5, n0 - 1, n0 + 0.12, za + d * 0.3 - 0.7, za + d * 0.3 + 0.7, CONCRETO);
  else peca(c, xa + w * 0.7 - 0.7, xa + w * 0.7 + 0.7, n0 - 1, n0 + 0.12, za - E / 2 - 0.5, za - E / 2, CONCRETO);

  mobilia(c, l, rnd);
  laje(c, l, rnd, topo);
}

// móveis: sala na frente (sofá, TV, geladeira, tapete) e quarto no fundo (cama, guarda-roupa); só os maiores colidem.
// Tudo fica encostado nas paredes, longe das portas e da passagem entre os cômodos.
function mobilia(c: Ctx, l: Lote, rnd: () => number): void {
  const { x, z, w, d, nivel: n0 } = l;
  const xa = x - w / 2 + E / 2;
  const xb = x + w / 2 - E / 2;
  const za = z - d / 2 + E / 2;
  const zb = z + d / 2 - E / 2;
  const tecido = [0x7a3b3b, 0x3b5d7a, 0x5a6b3a, 0x6b4f7a][Math.floor(rnd() * 4)];
  const cama = [0xd9b8c4, 0xb8c9d9, 0xd9d3b8][Math.floor(rnd() * 3)];
  const tapete = [0x9b4b3b, 0x3b6b9b][Math.floor(rnd() * 2)];
  const F = (x0: number, x1: number, yy0: number, yy1: number, z0: number, z1: number, cor: number, colide = false): void => peca(c, x0, x1, n0 + yy0, n0 + yy1, z0, z1, cor, colide, false);
  if (l.porta === "L") {
    const xm = x; // a divisória
    // sala (leste): sofá na parede norte, TV na parede leste (sul), geladeira na parede sul
    F(xm + 0.5, xb - 0.6, 0.0, 0.02, za + 1.0, zb - 1.0, tapete);
    F(xm + 0.5, xm + 2.0, 0.0, 0.45, za + 0.12, za + 0.85, tecido);
    F(xm + 0.5, xm + 2.0, 0.45, 0.95, za + 0.12, za + 0.27, tecido);
    F(xb - 0.5, xb - 0.12, 0.0, 0.5, zb - 2.2, zb - 1.0, 0x2b2b2b);
    F(xb - 0.3, xb - 0.2, 0.5, 0.9, zb - 2.0, zb - 1.2, 0x111114);
    F(xm + 0.7, xm + 1.3, 0.0, 1.65, zb - 0.65, zb - 0.1, 0xe8e8e8, true);
    // quarto (oeste): cama na parede oeste (norte) e guarda-roupa (sul)
    F(xa + 0.12, xa + 1.05, 0.0, 0.5, za + 0.2, za + 2.0, cama, true);
    F(xa + 0.12, xa + 1.05, 0.5, 0.65, za + 0.2, za + 0.55, 0xffffff);
    F(xa + 0.12, xa + 0.65, 0.0, 1.9, zb - 1.2, zb - 0.15, 0x7a5233, true);
  } else {
    const zm = z;
    // sala (norte): sofá na parede oeste, TV na parede leste, geladeira no canto noroeste
    F(xa + 1.0, xb - 1.0, 0.0, 0.02, za + 0.9, zm - 0.5, tapete);
    F(xa + 0.12, xa + 0.85, 0.0, 0.45, za + 0.9, zm - 0.3, tecido);
    F(xa + 0.12, xa + 0.27, 0.45, 0.95, za + 0.9, zm - 0.3, tecido);
    F(xb - 0.5, xb - 0.12, 0.0, 0.5, zm - 2.0, zm - 0.9, 0x2b2b2b);
    F(xb - 0.3, xb - 0.2, 0.5, 0.9, zm - 1.8, zm - 1.1, 0x111114);
    F(xa + 0.12, xa + 0.72, 0.0, 1.65, za + 0.12, za + 0.72, 0xe8e8e8, true);
    // quarto (sul)
    F(xb - 2.0, xb - 0.2, 0.0, 0.5, zb - 1.05, zb - 0.15, cama, true);
    F(xb - 0.55, xb - 0.2, 0.5, 0.65, zb - 1.05, zb - 0.15, 0xffffff);
    F(xa + 0.12, xa + 1.2, 0.0, 1.9, zb - 0.65, zb - 0.15, 0x7a5233, true);
  }
}

// em cima da laje: caixa d'água, antena, varal, pilares de espera com vergalhões e, em algumas casas, um puxadinho
function laje(c: Ctx, l: Lote, rnd: () => number, topo: number): void {
  const { x, z, w, d } = l;
  const xa = x - w / 2;
  const xb = x + w / 2;
  const za = z - d / 2;
  const zb = z + d / 2;
  // caixa d'água azul numa base de tijolos, no canto noroeste
  const tx = xa + 0.75;
  const tz = za + 0.75;
  c.m.faixa(tx - 0.5, tx + 0.5, topo, topo + 0.45, tz - 0.5, tz + 0.5, 0xb5532f);
  c.m.cilindro(tx, topo + 0.45 + 0.42, tz, 0.46, 0.84, 0x2c6fbb, 16);
  c.m.cilindro(tx, topo + 0.45 + 0.88, tz, 0.4, 0.06, 0x1f4f88, 16);
  c.blocos.push(circulo(tx, tz, 0.55, topo, topo + 1.3, false));
  // antena de TV e parabólica
  const ax = xb - 0.5;
  const az = zb - 0.55;
  c.m.barra(new THREE.Vector3(ax, topo, az), new THREE.Vector3(ax, topo + 2.2, az), 0.045, FERRO);
  c.m.barra(new THREE.Vector3(ax - 0.4, topo + 2.0, az), new THREE.Vector3(ax + 0.4, topo + 2.0, az), 0.03, FERRO);
  c.m.barra(new THREE.Vector3(ax - 0.3, topo + 1.65, az), new THREE.Vector3(ax + 0.3, topo + 1.65, az), 0.03, FERRO);
  if (rnd() < 0.6) {
    c.m.cilindro(xb - 1.2, topo + 0.28, zb - 0.9, 0.02, 0.56, FERRO, 5);
    c.m.caixa(xb - 1.2, topo + 0.58, zb - 0.92, 0.5, 0.5, 0.04, 0xdcdcdc, 0.3);
  }
  // pilares de espera (a casa vai crescer): coluna de concreto com vergalhões à mostra
  for (const [px, pz] of [[xa + 0.25, zb - 0.3], [xb - 0.25, za + 0.3]] as [number, number][]) {
    if (l.puxadinho && px > xb - 3.5 && pz < za + 3.5) continue; // o puxadinho ocupa esse canto
    c.m.faixa(px - 0.1, px + 0.1, topo, topo + 0.8, pz - 0.1, pz + 0.1, CONCRETO_CLARO);
    for (const [ox, oz] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) c.m.barra(new THREE.Vector3(px + ox, topo + 0.8, pz + oz), new THREE.Vector3(px + ox, topo + 1.35, pz + oz), 0.018, FERRUGEM);
  }
  // varal com roupas coloridas
  const vz = za + d * 0.5 + 0.3;
  const vx0 = xa + 1.7;
  const vx1 = xa + 1.7 + Math.min(1.6, w - 3.0);
  if (vx1 - vx0 > 0.8 && !(l.puxadinho && vx1 > xb - 3.3 && vz < za + 3.4)) {
    c.m.barra(new THREE.Vector3(vx0, topo + 1.5, vz), new THREE.Vector3(vx0, topo, vz), 0.03, FERRO);
    c.m.barra(new THREE.Vector3(vx1, topo + 1.5, vz), new THREE.Vector3(vx1, topo, vz), 0.03, FERRO);
    c.m.barra(new THREE.Vector3(vx0, topo + 1.5, vz), new THREE.Vector3(vx1, topo + 1.5, vz), 0.015, 0xdddddd);
    const roupas = [0xd04040, 0x4080d0, 0xe0d040, 0x40b070, 0xf0f0f0];
    const n = Math.floor((vx1 - vx0) / 0.34);
    for (let i = 0; i < n; i++) c.m.caixa(vx0 + 0.25 + i * 0.34, topo + 1.28, vz, 0.26, 0.42, 0.02, roupas[Math.floor(rnd() * roupas.length)]);
  }
  if (l.puxadinho) puxadinho(c, l, topo);
}

// quartinho em cima da laje, no canto nordeste: porta para oeste, janela ao norte, teto de laje que também dá para subir
function puxadinho(c: Ctx, l: Lote, topo: number): void {
  const { x, z, w, d } = l;
  const xb = x + w / 2;
  const za = z - d / 2;
  const x1 = xb - 0.1;
  const x0 = Math.max(x - w / 2 + 1.6, x1 - 3.0);
  const z0 = za + 0.2;
  const z1 = z0 + 2.8;
  const ep = 0.15;
  const alt = 2.3;
  const cor = PINTURAS[(l.cor + 3) % PINTURAS.length];
  parede(c, "x", z0 + ep / 2, x0, x1, ep, topo, topo + alt, [{ c: (x0 + x1) / 2, l: 0.9, y0: 0.95, y1: 1.85, tipo: "janela" }], cor[0], cor[1], -1);
  parede(c, "x", z1 - ep / 2, x0, x1, ep, topo, topo + alt, [], cor[0], cor[1], 1);
  parede(c, "z", x1 - ep / 2, z0 + ep, z1 - ep, ep, topo, topo + alt, [], cor[0], cor[1], 1);
  parede(c, "z", x0 + ep / 2, z0 + ep, z1 - ep, ep, topo, topo + alt, [{ c: (z0 + z1) / 2, l: 0.9, y0: 0, y1: 2.0, tipo: "porta" }], cor[0], cor[1], -1);
  peca(c, x0 - 0.1, x1 + 0.1, topo + alt, topo + alt + 0.12, z0 - 0.1, z1 + 0.1, CONCRETO); // teto
  // cama dentro
  peca(c, x1 - 1.1, x1 - 0.2, topo, topo + 0.45, z0 + 0.3, z0 + 2.1, 0xd9b8c4, true, false);
}

// ---------------------------------------------------------------- postes e fios
function postes(c: Ctx, t: Terreno): void {
  const passo = 7.7;
  const pts: THREE.Vector3[] = [];
  for (let gx = -49; gx <= -20; gx += passo) {
    for (let gz = 25.5; gz <= 53; gz += passo) {
      // só onde não encosta em casa nenhuma (nem na escada nem no degrau da porta)
      let livre = true;
      for (const l of LOTES) {
        const x0 = l.x - l.w / 2 - E - 0.5 - (l.escada === "O" ? 1.2 : 0);
        const x1 = l.x + l.w / 2 + E + 0.5 + (l.porta === "L" ? 0.8 : 0);
        const z0 = l.z - l.d / 2 - E - 0.5 - (l.porta === "N" ? 0.8 : 0);
        const z1 = l.z + l.d / 2 + E + 0.5 + (l.escada === "S" ? 1.2 : 0);
        if (gx > x0 && gx < x1 && gz > z0 && gz < z1) livre = false;
      }
      if (!livre) continue;
      const y = t.altura(gx, gz);
      const topo = new THREE.Vector3(gx, y + 7, gz);
      pts.push(topo);
      c.m.cilindro(gx, y + 3.5, gz, 0.1, 7, 0x6b5a48, 8);
      c.m.caixa(gx, y + 6.7, gz, 1.3, 0.08, 0.08, MADEIRA);
      c.m.caixa(gx, y + 6.7, gz, 0.08, 0.08, 1.3, MADEIRA);
      c.blocos.push(circulo(gx, gz, 0.15, y, y + 7, false));
    }
  }
  // fios entre postes vizinhos, com um pouco de barriga
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i];
      const b = pts[j];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 11) continue;
      for (const off of [-0.5, 0, 0.5]) {
        let ant = new THREE.Vector3(a.x + off, a.y - 0.3, a.z);
        for (let s = 1; s <= 6; s++) {
          const f = s / 6;
          const pt = new THREE.Vector3(a.x + (b.x - a.x) * f + off, a.y - 0.3 + (b.y - a.y) * f - Math.sin(f * Math.PI) * 0.45, a.z + (b.z - a.z) * f);
          c.m.barra(ant, pt, 0.02, 0x111111);
          ant = pt;
        }
      }
    }
  }
}

// ---------------------------------------------------------------- o fundo da comunidade (inacessível)
// Além do limite do mapa o morro continua subindo, coberto de casas empilhadas, como se a vila seguisse. É só visual:
// sem colisão, sem interior, sem sombra. O relevo vem de alturaFundo (mapa.ts), então emenda com a borda do terreno.
function fundo(): THREE.Group {
  const saida = new THREE.Group();
  const rnd = gerador(4242);

  // chão: duas faixas em volta do canto sudoeste do terreno
  const posicoes: number[] = [];
  const cores: number[] = [];
  const indices: number[] = [];
  const cor = new THREE.Color();
  const faixaDeChao = (x0: number, x1: number, z0: number, z1: number, passo: number): void => {
    const nx = Math.round((x1 - x0) / passo);
    const nz = Math.round((z1 - z0) / passo);
    const base = posicoes.length / 3;
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const x = x0 + (i * (x1 - x0)) / nx;
        const z = z0 + (j * (z1 - z0)) / nz;
        posicoes.push(x, alturaFundo(x, z), z);
        cor.setRGB(0.5, 0.4, 0.29).multiplyScalar(0.8 + rnd() * 0.3);
        cores.push(cor.r, cor.g, cor.b);
      }
    }
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const a = base + i * (nz + 1) + j;
        const b = a + 1;
        const c = a + nz + 1;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
  };
  faixaDeChao(-190, -60, 20, 190, 5); // a oeste do terreno
  faixaDeChao(-60, 20, 60, 190, 5); // ao sul do terreno
  const chao = new THREE.BufferGeometry();
  chao.setAttribute("position", new THREE.Float32BufferAttribute(posicoes, 3));
  chao.setAttribute("color", new THREE.Float32BufferAttribute(cores, 3));
  chao.setIndex(indices);
  chao.computeVertexNormals();
  const malhaChao = new THREE.Mesh(chao, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  malhaChao.position.y = -0.4; // um pouco abaixo, para as casas não flutuarem onde o chão é grosseiro
  malhaChao.receiveShadow = false;
  saida.add(malhaChao);

  // casas empilhadas: grade apertada, cada uma sobe alguns andares (cada andar com sua cor e um leve desvio, como obra por etapas)
  const m = new Malha();
  const ANDAR = 2.9;
  const tanques = [0x2f6fb5, 0x2f6fb5, 0x3d7fc4, 0xc8ccd0];
  const PASSO = 5.9;
  for (let gx = -150; gx <= -50; gx += PASSO) {
    for (let gz = 28; gz <= 150; gz += PASSO) {
      const w = 3.7 + rnd() * 1.7;
      const d = 3.7 + rnd() * 1.7;
      const x = gx + (rnd() - 0.5) * 1.2 + (Math.floor((gz - 28) / PASSO) % 2) * 2.2;
      const z = gz + (rnd() - 0.5) * 1.2;
      const nAndares = 1 + Math.floor(rnd() * 3);
      const sorteios = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
      // só depois do limite jogável (com folga) e dentro do alcance da vista
      const alem = x + w / 2 < -57 || (z - d / 2 > 57 && x < -28);
      if (!alem || Math.hypot(x + 50, z - 50) > 108) continue;
      const hs = [alturaFundo(x - w / 2, z - d / 2), alturaFundo(x + w / 2, z - d / 2), alturaFundo(x - w / 2, z + d / 2), alturaFundo(x + w / 2, z + d / 2)];
      const yBase = Math.max(...hs) - 0.3;
      let y0 = Math.min(...hs) - 1.5;
      let xx = x;
      let zz = z;
      let ww = w;
      let dd = d;
      for (let a = 0; a < nAndares; a++) {
        const [parede] = PINTURAS[Math.floor(rnd() * (rnd() < 0.7 ? NUM_TIJOLO : PINTURAS.length))];
        const y1 = yBase + (a + 1) * ANDAR;
        m.caixa(xx, (y0 + y1) / 2, zz, ww, y1 - y0, dd, parede);
        // janelas só nas faces que olham para a obra (leste e norte)
        const base = y1 - ANDAR;
        const nj = Math.max(1, Math.floor(ww / 1.9));
        for (let k = 0; k < nj; k++) {
          const px = xx - ww / 2 + ((k + 0.5) * ww) / nj;
          if (rnd() < 0.8) m.caixa(px, base + 1.5, zz - dd / 2 - 0.02, 0.85, 0.95, 0.05, rnd() < 0.2 ? 0x8a6a3a : VIDRO);
        }
        const nl = Math.max(1, Math.floor(dd / 1.9));
        for (let k = 0; k < nl; k++) {
          const pz = zz - dd / 2 + ((k + 0.5) * dd) / nl;
          if (rnd() < 0.8) m.caixa(xx + ww / 2 + 0.02, base + 1.5, pz, 0.05, 0.95, 0.85, rnd() < 0.2 ? 0x8a6a3a : VIDRO);
        }
        y0 = y1;
        xx += (rnd() - 0.5) * 0.5;
        zz += (rnd() - 0.5) * 0.5;
        ww = Math.max(3.2, ww + (rnd() - 0.5) * 0.6);
        dd = Math.max(3.2, dd + (rnd() - 0.5) * 0.6);
      }
      // laje: concreto, caixa d'água, pilares de espera, às vezes um telhadinho de zinco
      const topo = y0;
      m.caixa(xx, topo + 0.1, zz, ww + 0.3, 0.2, dd + 0.3, CONCRETO);
      if (sorteios[0] < 0.65) {
        const tx = xx + (sorteios[1] - 0.5) * (ww - 1.4);
        const tz = zz + (sorteios[2] - 0.5) * (dd - 1.4);
        m.cilindro(tx, topo + 0.6, tz, 0.55, 0.9, tanques[Math.floor(sorteios[3] * tanques.length)], 10);
      }
      if (sorteios[4] < 0.4) {
        for (const [ox, oz] of [[-1, -1], [1, 1]]) m.caixa(xx + (ox * (ww - 0.6)) / 2, topo + 0.6, zz + (oz * (dd - 0.6)) / 2, 0.2, 1.0, 0.2, CONCRETO_CLARO);
      }
      if (sorteios[5] < 0.3) m.caixa(xx, topo + 1.5, zz, ww * 0.7, 0.05, dd * 0.7, 0x8f969c);
    }
  }
  saida.add(m.construir(false));
  return saida;
}

// ---------------------------------------------------------------- tudo junto
export interface Favela {
  grupo: THREE.Group;
  // blocos de colisão perto de (x, z) (paredes, lajes, escadas, móveis, postes)
  perto(x: number, z: number): Bloco[];
  // contorno de cada casa, para os veículos não passarem por cima
  pegadas: Bloco[];
}

const CELULA_GRADE = 8;
const chave = (i: number, j: number): number => i * 4096 + j;

export function construirFavela(cena: THREE.Scene, terreno: Terreno): Favela {
  const grupo = new THREE.Group();
  const ctx: Ctx = { m: new Malha(), blocos: [] };
  const pegadas: Bloco[] = [];
  for (const l of LOTES) {
    casa(ctx, l);
    pegadas.push(caixa(l.x, l.z, 0, l.w / 2 + E + 1.1, l.d / 2 + E + 1.1, l.nivel - 1, l.nivel + 4.5));
  }
  postes(ctx, terreno);
  grupo.add(fundo());
  grupo.add(ctx.m.construir());
  cena.add(grupo);

  // grade espacial: cada bloco entra em todas as células que cobre
  const grade = new Map<number, Bloco[]>();
  for (const b of ctx.blocos) {
    const r = Math.max(b.hx, b.hz) * (b.circulo ? 1 : Math.SQRT2);
    const i0 = Math.floor((b.x - r) / CELULA_GRADE);
    const i1 = Math.floor((b.x + r) / CELULA_GRADE);
    const j0 = Math.floor((b.z - r) / CELULA_GRADE);
    const j1 = Math.floor((b.z + r) / CELULA_GRADE);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = chave(i + 2048, j + 2048);
        const lista = grade.get(k);
        if (lista) lista.push(b);
        else grade.set(k, [b]);
      }
    }
  }
  const vazio: Bloco[] = [];
  return {
    grupo,
    pegadas,
    perto(x: number, z: number): Bloco[] {
      const i = Math.floor(x / CELULA_GRADE);
      const j = Math.floor(z / CELULA_GRADE);
      if (x > -12 || z < 12) return vazio; // longe do morro: nada
      const saida = new Set<Bloco>();
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const b of grade.get(chave(i + di + 2048, j + dj + 2048)) ?? vazio) saida.add(b);
      return [...saida];
    },
  };
}
