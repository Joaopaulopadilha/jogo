import * as THREE from "three";
import { Bloco, caixa, caixasSeCruzam, empurraoCaixas } from "./colisao";

// Árvores que os veículos derrubam e empurram.
//  - A máquina (pesada) derruba com poucas batidas; o caminhão (mais leve) precisa de mais velocidade ou de várias.
//  - A árvore balança, tomba para longe de quem bateu e fica deitada: a copa encolhe um pouco e suja.
//  - Deitada, ela não bloqueia ninguém: os veículos a empurram como uma pá empurra terra, e dá para amontoar várias
//    (uma por cima da outra).

export interface DadosArvore {
  x: number;
  y: number; // altura do terreno na base
  z: number;
  esc: number; // tamanho (1 = padrão)
  giroCopa: number;
}

export const MASSA_MAQUINA = 4;
export const MASSA_CAMINHAO = 1.3;
const VEL_MIN_GOLPE = 0.7; // abaixo disso é só encostar: não machuca a árvore
const RESISTENCIA = 8; // "vida" de uma árvore de tamanho 1 (as grandes aguentam mais)
const INTERVALO_GOLPE = 0.3; // s entre dois golpes na mesma árvore
const DURACAO_QUEDA = 1.5; // s

// o que acontece com a árvore depois de caída
const COPA_RAIO = 0.68; // a copa fica com 68% da largura (as folhas murcham e amassam)
const COPA_COMPR = 0.9;
const COR_COPA_SUJA = "#5a5330"; // verde virando seco e sujo de terra
const COR_TRONCO_SUJO = "#3a2b1d";
const METADE_TRONCO = 2.8; // meio comprimento da árvore deitada (x escala), usado na colisão
const LARGURA_TRONCO = 0.8; // meia largura (x escala)
const ALTURA_PILHA = 0.55; // quanto cada árvore por baixo levanta a de cima (x escala)
const PASSO_MAX = 0.5; // m: o maior empurrão num quadro (evita "tiros" quando a sobreposição é grande)

// quanto uma batida machuca a árvore: massa do veículo x quanto passa da velocidade mínima
export function energiaDaBatida(massa: number, vel: number): number {
  return massa * Math.max(0, Math.abs(vel) - VEL_MIN_GOLPE);
}

export type Resultado = "nada" | "abalou" | "caiu";

interface Estado {
  i: number;
  d: DadosArvore;
  bloco: Bloco;
  hp: number;
  hpMax: number;
  t: number; // tempo desde que começou a cair (-1 = em pé)
  deitada: boolean;
  dir: number; // rumo do eixo da árvore deitada: do pé para a copa, vetor (sin dir, cos dir)
  x: number; // posição do pé (muda quando empurrada)
  z: number;
  alt: number; // quanto está levantada por cima de outras árvores (suavizado)
  altAlvo: number;
  arrastado: number; // metros já arrastados (quanto mais rolou, mais suja)
  variacao: number; // cada árvore suja um pouco diferente
  alvo: { x: number; z: number; rumo: number } | null; // convidados: para onde o anfitrião mandou
  abalo: number;
  abaloT: number;
  abaloDir: number;
  golpeEm: number;
}

const Y = new THREE.Vector3(0, 1, 0);
const BRANCO = new THREE.Color(1, 1, 1);

export class Floresta {
  private readonly est: Estado[];
  private readonly ativas = new Set<Estado>();
  // chamado quando uma árvore começa a cair (local = fui eu que derrubei, não é eco da rede)
  aoCair: ((x: number, y: number, z: number, dir: number, esc: number, local: boolean) => void) | null = null;
  // chamado a cada batida que não derrubou (som de pancada)
  aoAbalar: ((x: number, y: number, z: number, forca: number, local: boolean) => void) | null = null;

  private readonly razaoCopa: THREE.Color;
  private readonly razaoTronco: THREE.Color;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();
  private readonly qDeitada = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly pBase = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly eixo = new THREE.Vector3();
  private readonly cor = new THREE.Color();

  // `vivas` é a lista de blocos de colisão das árvores em pé; as que caem saem dela
  constructor(
    private readonly tronco: THREE.InstancedMesh,
    private readonly copa: THREE.InstancedMesh,
    dados: DadosArvore[],
    private readonly vivas: Bloco[],
    private readonly alturaDe: (x: number, z: number) => number,
    private readonly limitar: (x: number, z: number) => [number, number],
  ) {
    this.est = dados.map((d, i) => {
      const bloco = vivas.find((b) => b.id === i);
      if (!bloco) throw new Error("árvore sem bloco de colisão: " + i);
      const hpMax = RESISTENCIA * d.esc;
      return {
        i, d, bloco, hp: hpMax, hpMax, t: -1, deitada: false, dir: 0, x: d.x, z: d.z, alt: 0, altAlvo: 0, arrastado: 0,
        variacao: 0.88 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.24,
        alvo: null, abalo: 0, abaloT: 0, abaloDir: 0, golpeEm: -1e9,
      };
    });
    // as cores por instância começam brancas (sem tingir): o padrão do three é preto
    for (let i = 0; i < this.est.length; i++) {
      tronco.setColorAt(i, BRANCO);
      copa.setColorAt(i, BRANCO);
    }
    // quanto multiplicar a cor do material para chegar na cor "suja"
    const razao = (alvo: string, mat: THREE.Material): THREE.Color => {
      const base = (mat as THREE.MeshStandardMaterial).color;
      const a = new THREE.Color(alvo);
      return new THREE.Color(a.r / Math.max(base.r, 1e-3), a.g / Math.max(base.g, 1e-3), a.b / Math.max(base.b, 1e-3));
    };
    this.razaoCopa = razao(COR_COPA_SUJA, copa.material as THREE.Material);
    this.razaoTronco = razao(COR_TRONCO_SUJO, tronco.material as THREE.Material);
    this.marcar();
  }

  // ---------------- batidas ----------------

  // uma batida (só o anfitrião ou quem simula chama isto). dir = rumo de quem bateu para a árvore.
  atingir(bloco: Bloco, energia: number, dir: number): { resultado: Resultado; id: number; forca: number } {
    const id = bloco.id ?? -1;
    const e = this.est[id];
    const agora = performance.now() / 1000;
    if (!e || e.t >= 0 || energia <= 0.01 || agora - e.golpeEm < INTERVALO_GOLPE) return { resultado: "nada", id, forca: 0 };
    e.golpeEm = agora;
    e.hp -= energia;
    if (e.hp > 0) {
      const forca = Math.min(1, 0.35 + energia / e.hpMax);
      this.abalar(e, dir, forca, true);
      return { resultado: "abalou", id, forca };
    }
    this.derrubar(e, dir, true);
    return { resultado: "caiu", id, forca: 1 };
  }

  // eventos vindos da rede (convidados): 0 = abalou, 1 = caiu
  aplicar(id: number, tipo: number, dir: number, forca: number): void {
    const e = this.est[id];
    if (!e || e.t >= 0) return;
    if (tipo === 1) this.derrubar(e, dir, false);
    else this.abalar(e, dir, Math.max(0.2, Math.min(1, forca)), false);
  }

  private abalar(e: Estado, dir: number, forca: number, local: boolean): void {
    e.abalo = Math.max(e.abalo, forca);
    e.abaloT = 0;
    e.abaloDir = dir;
    this.ativas.add(e);
    this.aoAbalar?.(e.d.x, e.d.y, e.d.z, forca, local);
  }

  private derrubar(e: Estado, dir: number, local: boolean): void {
    e.t = 0;
    e.dir = dir;
    e.hp = 0;
    this.tirarDaColisao(e);
    this.ativas.add(e);
    this.aoCair?.(e.d.x, e.d.y, e.d.z, dir, e.d.esc, local);
  }

  private tirarDaColisao(e: Estado): void {
    const i = this.vivas.indexOf(e.bloco);
    if (i >= 0) this.vivas.splice(i, 1);
  }

  // ---------------- empurrar as árvores caídas ----------------

  // caixa de colisão da árvore deitada (para ser empurrada e para saber quem está em cima de quem)
  private caixaTronco(e: Estado): Bloco {
    const c = METADE_TRONCO * e.d.esc;
    const cx = e.x + Math.sin(e.dir) * c;
    const cz = e.z + Math.cos(e.dir) * c;
    const y = this.alturaDe(cx, cz) + e.alt;
    return caixa(cx, cz, e.dir, LARGURA_TRONCO * e.d.esc, c, y - 0.3, y + 1.3 * e.d.esc, false);
  }

  // os corpos de um veículo (perto de cx, cz) empurram as árvores caídas que encostam neles.
  // Devolve os ids das que se mexeram (o anfitrião manda a nova posição para os convidados).
  empurrar(corpos: Bloco[], cx: number, cz: number): number[] {
    const mexidas: number[] = [];
    for (const e of this.est) {
      if (!e.deitada || Math.hypot(e.x - cx, e.z - cz) > 14) continue;
      const tr = this.caixaTronco(e);
      let mx = 0;
      let mz = 0;
      let ox = 0;
      let oz = 0;
      for (const c of corpos) {
        if (c.y0 >= tr.y1 || c.y1 <= tr.y0) continue; // passa por cima ou por baixo
        const r = empurraoCaixas(c, tr);
        if (r) {
          mx += r.x;
          mz += r.z;
          ox = c.x;
          oz = c.z;
        }
      }
      const tam = Math.hypot(mx, mz);
      if (tam < 1e-4) continue;
      if (tam > PASSO_MAX) { mx *= PASSO_MAX / tam; mz *= PASSO_MAX / tam; }
      // empurrada longe do meio, a árvore gira (como um tronco que se empurra por uma ponta)
      const c = METADE_TRONCO * e.d.esc;
      const ax = Math.sin(e.dir);
      const az = Math.cos(e.dir);
      const t = Math.max(-c, Math.min(c, (ox - tr.x) * ax + (oz - tr.z) * az));
      const rx = ax * t;
      const rz = az * t;
      const giro = Math.max(-0.15, Math.min(0.15, (0.6 * (rz * mx - rx * mz)) / ((c * c) / 3)));
      const novoRumo = e.dir + giro;
      const [px, pz] = this.limitar(tr.x + mx - Math.sin(novoRumo) * c, tr.z + mz - Math.cos(novoRumo) * c);
      e.arrastado += Math.hypot(px - e.x, pz - e.z);
      e.x = px;
      e.z = pz;
      e.dir = novoRumo;
      e.alvo = null;
      this.escrever(e);
      this.recalcularPilha(e);
      mexidas.push(e.i);
    }
    if (mexidas.length > 0) this.marcar();
    return mexidas;
  }

  // quem está por cima de quem: a árvore de número maior sobe por cima das de número menor que ela cobre
  private recalcularPilha(centro: Estado): void {
    const perto = this.est.filter((e) => e.deitada && Math.hypot(e.x - centro.x, e.z - centro.z) < 12);
    const caixas = new Map<Estado, Bloco>();
    for (const e of perto) { const c = this.caixaTronco(e); c.y0 = 0; c.y1 = 0; caixas.set(e, c); }
    for (const e of perto) {
      let alt = 0;
      for (const o of perto) if (o.i < e.i && caixasSeCruzam(caixas.get(e)!, caixas.get(o)!)) alt += ALTURA_PILHA * o.d.esc;
      e.altAlvo = Math.min(alt, 1.6 * e.d.esc);
      if (e.alt !== e.altAlvo) this.ativas.add(e);
    }
  }

  // ---------------- rede e obra salva ----------------

  // pose de uma árvore caída: [id, x, z, rumo]
  pose(id: number): number[] {
    const e = this.est[id];
    return e ? [id, Math.round(e.x * 1000) / 1000, Math.round(e.z * 1000) / 1000, Math.round(e.dir * 1000) / 1000] : [id, 0, 0, 0];
  }

  // convidados: o anfitrião empurrou uma árvore; ela desliza até a nova pose
  posicionar(id: number, x: number, z: number, rumo: number): void {
    const e = this.est[id];
    if (!e || !e.deitada || !isFinite(x) || !isFinite(z) || !isFinite(rumo) || Math.abs(x) > 200 || Math.abs(z) > 200) return;
    e.alvo = { x, z, rumo };
    this.ativas.add(e);
  }

  // [[id, rumo, x, z], ...] das árvores que já caíram (para quem entra na sala e para salvar a obra)
  derrubadas(): number[][] {
    const r: number[][] = [];
    this.est.forEach((e, i) => { if (e.t >= 0) r.push([i, Math.round(e.dir * 1000) / 1000, Math.round(e.x * 1000) / 1000, Math.round(e.z * 1000) / 1000]); });
    return r;
  }

  // põe árvores já deitadas (e onde estavam), sem animação
  restaurar(lista: unknown): void {
    if (!Array.isArray(lista)) return;
    for (const item of lista) {
      if (!Array.isArray(item)) continue;
      const i = Number(item[0]);
      const e = this.est[i];
      if (!e || !Number.isInteger(i) || e.t >= 0) continue;
      e.dir = Number(item[1]) || 0;
      const x = Number(item[2]);
      const z = Number(item[3]);
      if (isFinite(x) && isFinite(z) && item[2] !== undefined && Math.abs(x) < 200 && Math.abs(z) < 200) { e.x = x; e.z = z; }
      e.t = DURACAO_QUEDA;
      e.deitada = true;
      e.hp = 0;
      this.tirarDaColisao(e);
    }
    for (const e of this.est) if (e.deitada) this.recalcularPilha(e);
    for (const e of this.est) if (e.deitada) { e.alt = e.altAlvo; this.escrever(e); }
    this.marcar();
  }

  // ---------------- animação ----------------

  // anima as árvores que estão balançando, caindo, deslizando ou se acomodando na pilha
  atualizar(dt: number): void {
    if (this.ativas.size === 0) return;
    for (const e of [...this.ativas]) {
      if (e.abalo > 0) {
        e.abaloT += dt;
        e.abalo *= Math.exp(-dt * 4.5);
        if (e.abalo < 0.015) e.abalo = 0;
      }
      if (e.t >= 0 && !e.deitada) {
        e.t += dt;
        if (e.t >= DURACAO_QUEDA) { e.t = DURACAO_QUEDA; e.deitada = true; this.recalcularPilha(e); }
      }
      let acabou = true;
      if (e.alvo) {
        const f = 1 - Math.exp(-dt * 14);
        const dr = Math.atan2(Math.sin(e.alvo.rumo - e.dir), Math.cos(e.alvo.rumo - e.dir));
        e.arrastado += Math.hypot(e.alvo.x - e.x, e.alvo.z - e.z) * f;
        e.x += (e.alvo.x - e.x) * f;
        e.z += (e.alvo.z - e.z) * f;
        e.dir += dr * f;
        if (Math.abs(e.alvo.x - e.x) + Math.abs(e.alvo.z - e.z) < 0.004 && Math.abs(dr) < 0.003) {
          e.x = e.alvo.x;
          e.z = e.alvo.z;
          e.dir = e.alvo.rumo;
          e.alvo = null;
          this.recalcularPilha(e);
        } else acabou = false;
      }
      if (e.alt !== e.altAlvo) {
        const passo = dt * 0.9;
        e.alt = Math.abs(e.altAlvo - e.alt) <= passo ? e.altAlvo : e.alt + Math.sign(e.altAlvo - e.alt) * passo;
        if (e.alt !== e.altAlvo) acabou = false;
      }
      this.escrever(e);
      if (acabou && e.abalo === 0 && (e.t < 0 || e.deitada)) this.ativas.delete(e);
    }
    this.marcar();
  }

  private marcar(): void {
    this.tronco.instanceMatrix.needsUpdate = true;
    this.copa.instanceMatrix.needsUpdate = true;
    if (this.tronco.instanceColor) this.tronco.instanceColor.needsUpdate = true;
    if (this.copa.instanceColor) this.copa.instanceColor.needsUpdate = true;
  }

  // posição, giro, tamanho e cor do tronco e da copa: tudo gira em volta do pé da árvore
  private escrever(e: Estado): void {
    const d = e.d;
    const caindo = e.t >= 0;
    const u = caindo ? Math.min(1, e.t / DURACAO_QUEDA) : 0;
    const f = u * u; // começa devagar e acelera, como uma árvore que tomba

    const yPe = caindo ? this.alturaDe(e.x, e.z) : d.y;
    if (caindo) {
      // o eixo da árvore deitada acompanha a inclinação do terreno do pé até a copa
      const L = 5.4 * d.esc;
      const dy = this.alturaDe(e.x + Math.sin(e.dir) * L, e.z + Math.cos(e.dir) * L) - yPe;
      this.v.set(Math.sin(e.dir) * L, dy, Math.cos(e.dir) * L).normalize();
      this.qDeitada.setFromUnitVectors(Y, this.v);
      this.q.identity().slerp(this.qDeitada, f);
    } else {
      this.q.identity();
    }
    if (e.abalo > 0) {
      this.eixo.set(Math.cos(e.abaloDir), 0, -Math.sin(e.abaloDir));
      this.q2.setFromAxisAngle(this.eixo, e.abalo * 0.1 * Math.sin(e.abaloT * 26));
      this.q.multiply(this.q2);
    }
    const levanta = 0.75 * d.esc * Math.sin(f * Math.PI / 2) + e.alt; // deitada, descansa sobre o chão (ou sobre outras árvores)
    this.pBase.set(e.x, yPe + levanta, e.z);

    // tronco
    this.s.setScalar(d.esc);
    this.p.set(0, 1.1 * d.esc, 0).applyQuaternion(this.q).add(this.pBase);
    this.m.compose(this.p, this.q, this.s);
    this.tronco.setMatrixAt(e.i, this.m);

    // copa: depois de caída fica menor (as folhas amassam) e mais suja
    this.s.set(d.esc * (1 - (1 - COPA_RAIO) * f), d.esc * (1 - (1 - COPA_COMPR) * f), d.esc * (1 - (1 - COPA_RAIO) * f));
    this.p.set(0, 4.0 * d.esc, 0).applyQuaternion(this.q).add(this.pBase);
    this.q2.copy(this.q).multiply(this.qCopa.setFromAxisAngle(Y, d.giroCopa));
    this.m.compose(this.p, this.q2, this.s);
    this.copa.setMatrixAt(e.i, this.m);

    // sujeira: aparece enquanto cai e piora quanto mais a árvore é arrastada
    const sujo = f * (0.7 + 0.3 * Math.min(1, e.arrastado / 15));
    const fator = (r: number): number => 1 + sujo * (r - 1);
    const v = 1 + (e.variacao - 1) * sujo;
    this.cor.setRGB(fator(this.razaoCopa.r) * v, fator(this.razaoCopa.g) * v, fator(this.razaoCopa.b) * v);
    this.copa.setColorAt(e.i, this.cor);
    this.cor.setRGB(fator(this.razaoTronco.r) * v, fator(this.razaoTronco.g) * v, fator(this.razaoTronco.b) * v);
    this.tronco.setColorAt(e.i, this.cor);
  }

  private readonly qCopa = new THREE.Quaternion();
}
