import * as THREE from "three";

// Modelo da retroescavadeira montado com formas simples.
// Eixos do corpo: frente = +z, cima = +y, esquerda = +x. O chão fica em y = 0.

const amarelo = new THREE.MeshStandardMaterial({ color: "#f2b10f", roughness: 0.5, metalness: 0.15 });
const amareloEscuro = new THREE.MeshStandardMaterial({ color: "#d39a08", roughness: 0.55, metalness: 0.15 });
const aco = new THREE.MeshStandardMaterial({ color: "#2e3034", roughness: 0.6, metalness: 0.5 });
const borracha = new THREE.MeshStandardMaterial({ color: "#161616", roughness: 0.95 });
const cromo = new THREE.MeshStandardMaterial({ color: "#d9dee2", roughness: 0.2, metalness: 0.95 });
const vidro = new THREE.MeshStandardMaterial({ color: "#9fc8e0", roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28 });
const preto = new THREE.MeshStandardMaterial({ color: "#1d1f22", roughness: 0.7 });
const assento = new THREE.MeshStandardMaterial({ color: "#26282b", roughness: 0.85 });
const farol = new THREE.MeshStandardMaterial({ color: "#fff6d8", emissive: "#fff2c0", emissiveIntensity: 0.6 });
export const materialTerra = new THREE.MeshStandardMaterial({ color: "#6e4b2a", roughness: 1 });

function caixa(w: number, h: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function cilindroX(r: number, largura: number, mat: THREE.Material, seg = 24): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, largura, seg), mat);
  m.rotation.z = Math.PI / 2;
  m.castShadow = true;
  return m;
}

// roda com pneu de garras; gira em torno do eixo x
function criarRoda(raio: number, largura: number): THREE.Group {
  const roda = new THREE.Group();
  roda.add(cilindroX(raio * 0.93, largura, borracha, 28));
  const aro = cilindroX(raio * 0.55, largura + 0.02, amarelo);
  roda.add(aro);
  const cubo = cilindroX(raio * 0.18, largura + 0.08, aco, 12);
  roda.add(cubo);
  const garras = 18;
  for (let g = 0; g < garras; g++) {
    const a = (g / garras) * Math.PI * 2;
    for (const lado of [-1, 1]) {
      const garra = caixa(largura * 0.48, raio * 0.12, raio * 0.2, borracha);
      garra.position.set(lado * largura * 0.25, Math.sin(a) * raio * 0.95, Math.cos(a) * raio * 0.95);
      garra.rotation.x = -a + lado * 0.35;
      roda.add(garra);
    }
  }
  return roda;
}

// perfil de concha (casca curva + laterais), extrudado na largura; u = distância a partir do pino, v = altura
function criarConcha(perfil: [number, number][], espessura: number, largura: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const casca = new THREE.Shape();
  perfil.forEach(([u, v], n) => (n ? casca.lineTo(u, v) : casca.moveTo(u, v)));
  for (let n = perfil.length - 1; n >= 0; n--) {
    const [u, v] = perfil[n];
    const [ua, va] = perfil[Math.max(0, n - 1)];
    const [ub, vb] = perfil[Math.min(perfil.length - 1, n + 1)];
    // empurra para dentro (normal do segmento) para dar espessura
    const tx = ub - ua;
    const ty = vb - va;
    const len = Math.hypot(tx, ty) || 1;
    casca.lineTo(u + (ty / len) * espessura, v - (tx / len) * espessura);
  }
  const geoCasca = new THREE.ExtrudeGeometry(casca, { depth: largura, bevelEnabled: false });
  const lateral = new THREE.Shape();
  perfil.forEach(([u, v], n) => (n ? lateral.lineTo(u, v) : lateral.moveTo(u, v)));
  const geoLateral = new THREE.ExtrudeGeometry(lateral, { depth: 0.04, bevelEnabled: false });
  const ajustar = (geo: THREE.BufferGeometry, x: number) => {
    geo.rotateY(Math.PI / 2); // u → -z, extrusão → +x
    geo.translate(x, 0, 0);
    return geo;
  };
  const m1 = new THREE.Mesh(ajustar(geoCasca, -largura / 2), mat);
  const m3 = new THREE.Mesh(ajustar(geoLateral.clone(), largura / 2 - 0.04), mat); // clona antes de girar a outra
  const m2 = new THREE.Mesh(ajustar(geoLateral, -largura / 2), mat);
  for (const m of [m1, m2, m3]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

// viga com perfil lateral (u = distância para trás a partir do pino, v = altura), extrudada na largura
function viga(perfil: [number, number][], largura: number, mat: THREE.Material): THREE.Mesh {
  const forma = new THREE.Shape();
  perfil.forEach(([u, v], n) => (n ? forma.lineTo(u, v) : forma.moveTo(u, v)));
  const geo = new THREE.ExtrudeGeometry(forma, { depth: largura, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 });
  geo.rotateY(Math.PI / 2); // u → -z, extrusão → +x
  geo.translate(-largura / 2, 0, 0);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// coloca uma peça (pino) no pai, na posição dada. (pai.add() devolve o pai: não dá para encadear .position.set)
function pino(pai: THREE.Object3D, peca: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  peca.position.set(x, y, z);
  pai.add(peca);
  return peca;
}

// orelhas (duas chapas) com pino: onde o cilindro hidráulico se prende
function orelha(pai: THREE.Object3D, x: number, y: number, z: number, abertura = 0.24): THREE.Object3D {
  for (const lado of [-1, 1]) pai.add(caixa(0.04, 0.2, 0.2, aco, x + (lado * abertura) / 2, y, z));
  pino(pai, cilindroX(0.05, abertura + 0.08, cromo, 10), x, y, z);
  return ancora(pai, x, y, z);
}

// cilindro hidráulico entre dois pontos de ancoragem (camisa presa em A, haste presa em B)
class Cilindro {
  readonly camisa: THREE.Mesh;
  readonly haste: THREE.Mesh;
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private static readonly Y = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly pai: THREE.Object3D,
    private readonly ancoraA: THREE.Object3D,
    private readonly ancoraB: THREE.Object3D,
    raio: number,
    private readonly comprimento: number,
  ) {
    this.camisa = new THREE.Mesh(new THREE.CylinderGeometry(raio, raio, comprimento, 14), aco);
    this.haste = new THREE.Mesh(new THREE.CylinderGeometry(raio * 0.55, raio * 0.55, comprimento, 12), cromo);
    this.camisa.castShadow = this.haste.castShadow = true;
    pai.add(this.camisa, this.haste);
  }

  atualizar(): void {
    this.pai.worldToLocal(this.ancoraA.getWorldPosition(this.a));
    this.pai.worldToLocal(this.ancoraB.getWorldPosition(this.b));
    const dir = this.b.clone().sub(this.a);
    const dist = dir.length();
    dir.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(Cilindro.Y, dir);
    const lc = Math.min(this.comprimento, dist * 0.95);
    this.camisa.quaternion.copy(q);
    this.camisa.scale.y = lc / this.comprimento;
    this.camisa.position.copy(this.a).addScaledVector(dir, lc / 2);
    const lh = Math.min(this.comprimento, dist);
    this.haste.quaternion.copy(q);
    this.haste.scale.y = lh / this.comprimento;
    this.haste.position.copy(this.b).addScaledVector(dir, -lh / 2);
  }
}

function ancora(pai: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  pai.add(o);
  return o;
}

export interface Concha {
  ponta: THREE.Object3D; // gume (o que corta a terra)
  boca: THREE.Object3D; // de onde a terra cai ao despejar
  abertura: THREE.Vector3; // direção para onde a concha abre, no espaço local dela
  pivo: THREE.Object3D;
  terra: THREE.Mesh; // monte de terra dentro (escala pela carga)
  capacidade: number; // m³
  carga: number;
}

export const LIMITES = {
  giro: [-1.45, 1.45],
  lanca: [-0.65, 1.4],
  braco: [-2.95, -0.35],
  concha: [-2.6, 0.55],
  bracoFrente: [-0.55, 0.5],
  conchaFrente: [-0.75, 1.25],
} as const;

export class Retroescavadeira {
  readonly raiz = new THREE.Group(); // posição e rumo no mundo
  readonly corpo = new THREE.Group(); // inclinação sobre o terreno
  readonly entreEixos = 2.65;
  readonly rodas: { obj: THREE.Group; raio: number; dianteira: boolean; pivo: THREE.Group }[] = [];

  // articulações (ângulos em radianos)
  giro = 0;
  lanca = 1.3;
  braco = -2.85;
  concha = -1.9;
  bracoFrente = 0.12;
  conchaFrente = -0.35;
  sapatas = 0; // 0 recolhidas, 1 apoiadas no chão

  readonly giroG = new THREE.Group();
  readonly lancaG = new THREE.Group();
  readonly bracoG = new THREE.Group();
  readonly conchaG = new THREE.Group();
  readonly bracoFrenteG = new THREE.Group();
  readonly conchaFrenteG = new THREE.Group();
  private readonly sapataE = new THREE.Group();
  private readonly sapataD = new THREE.Group();
  readonly retro: Concha;
  readonly frente: Concha;
  readonly assentoPos = new THREE.Object3D();
  private readonly cilindros: Cilindro[] = [];

  constructor() {
    this.raiz.add(this.corpo);
    const c = this.corpo;

    // ---- chassi, capô e para-lamas ----
    c.add(caixa(1.5, 0.55, 4.1, aco, 0, 0.95, 0.25));
    c.add(caixa(1.15, 0.9, 1.75, amarelo, 0, 1.62, 1.35)); // capô
    c.add(caixa(1.2, 0.08, 1.8, amareloEscuro, 0, 2.08, 1.35));
    c.add(caixa(1.0, 0.6, 0.08, preto, 0, 1.55, 2.24)); // grade
    for (let n = 0; n < 5; n++) c.add(caixa(0.9, 0.04, 0.1, aco, 0, 1.33 + n * 0.11, 2.26));
    for (const x of [-0.45, 0.45]) {
      const f = caixa(0.2, 0.12, 0.05, farol, x, 1.98, 2.25);
      f.castShadow = false;
      c.add(f);
    }
    const escape = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 10), aco);
    escape.position.set(-0.35, 2.5, 1.7);
    c.add(escape);
    for (const lado of [-1, 1]) {
      c.add(caixa(0.55, 0.06, 1.7, amarelo, lado * 1.05, 1.62, -0.9)); // para-lama traseiro
      c.add(caixa(0.55, 0.45, 0.06, amarelo, lado * 1.05, 1.4, -0.06));
      c.add(caixa(0.36, 0.05, 0.9, amarelo, lado * 0.92, 1.12, 1.75)); // para-lama dianteiro
    }
    c.add(caixa(1.7, 0.45, 0.5, amarelo, 0, 1.1, -1.85)); // traseira (onde prende o braço)

    // ---- cabine ----
    const cab = new THREE.Group();
    cab.position.set(0, 1.25, -0.75);
    c.add(cab);
    cab.add(caixa(1.7, 0.12, 1.9, aco, 0, 0.06, 0));
    for (const [x, z] of [[-0.8, -0.9], [0.8, -0.9], [-0.8, 0.9], [0.8, 0.9]]) cab.add(caixa(0.09, 1.75, 0.09, preto, x, 0.95, z));
    cab.add(caixa(1.86, 0.12, 2.06, amarelo, 0, 1.88, 0)); // teto
    cab.add(caixa(1.7, 0.08, 1.95, amareloEscuro, 0, 1.97, 0));
    const vidros = [
      caixa(1.6, 1.6, 0.02, vidro, 0, 0.95, 0.9),
      caixa(1.6, 1.6, 0.02, vidro, 0, 0.95, -0.9),
      caixa(0.02, 1.6, 1.8, vidro, 0.8, 0.95, 0),
      caixa(0.02, 1.6, 1.8, vidro, -0.8, 0.95, 0),
    ];
    for (const v of vidros) {
      v.castShadow = false;
      cab.add(v);
    }
    cab.add(caixa(0.55, 0.12, 0.5, assento, 0, 0.55, 0)); // banco
    cab.add(caixa(0.55, 0.6, 0.1, assento, 0, 0.85, 0.25));
    cab.add(caixa(0.12, 0.7, 0.12, preto, 0, 0.45, 0.65)); // coluna do volante
    const volante = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 20), preto);
    volante.position.set(0, 0.85, 0.6);
    volante.rotation.x = -1.0;
    cab.add(volante);
    for (const x of [-0.3, 0.3]) cab.add(caixa(0.05, 0.35, 0.05, preto, x, 0.75, -0.55)); // alavancas da retro
    this.assentoPos.position.set(0, 1.25 + 1.25, -0.75);
    c.add(this.assentoPos);

    // ---- rodas ----
    const traseira = { raio: 0.78, z: -0.9, x: 1.05, largura: 0.5 };
    const dianteira = { raio: 0.52, z: 1.75, x: 0.92, largura: 0.34 };
    for (const r of [traseira, dianteira]) {
      for (const lado of [-1, 1]) {
        const pivo = new THREE.Group();
        pivo.position.set(lado * r.x, r.raio, r.z);
        const roda = criarRoda(r.raio, r.largura);
        pivo.add(roda);
        c.add(pivo);
        this.rodas.push({ obj: roda, raio: r.raio, dianteira: r === dianteira, pivo });
      }
    }

    // ---- carregadeira frontal ----
    this.bracoFrenteG.position.set(0, 1.95, -0.05);
    c.add(this.bracoFrenteG);
    for (const lado of [-1, 1]) {
      const braco = new THREE.Group();
      braco.position.x = lado * 1.08;
      this.bracoFrenteG.add(braco);
      braco.add(caixa(0.14, 0.28, 1.9, amarelo, 0, 0, 0.95));
      const dobra = caixa(0.14, 0.28, 1.55, amarelo, 0, -0.32, 2.55);
      dobra.rotation.x = 0.42;
      braco.add(dobra);
    }
    this.bracoFrenteG.add(caixa(2.3, 0.18, 0.18, amarelo, 0, -0.5, 2.6)); // travessa
    this.conchaFrenteG.position.set(0, -0.6, 3.3);
    this.bracoFrenteG.add(this.conchaFrenteG);
    // concha da frente: abre para frente/cima (u negativo → para frente)
    const cf = criarConcha(
      [[0.0, 0.75], [0.12, 0.2], [0.05, -0.2], [-0.25, -0.38], [-0.6, -0.42], [-0.92, -0.4]],
      0.06, 2.35, amarelo,
    );
    this.conchaFrenteG.add(cf);
    const gumeF = caixa(2.35, 0.04, 0.12, aco, 0, -0.41, 0.95);
    this.conchaFrenteG.add(gumeF);
    this.frente = this.montarConcha(this.conchaFrenteG, [0, -0.4, 0.95], [0, 0.0, 0.55], [0, 0.75, 0.66], 0.9, [1.7, 0.45, 0.7], [0, -0.15, 0.45]);

    // ---- retroescavadeira (braço traseiro) ----
    // suporte de giro preso no chassi: chapas em cima e embaixo com o pino vertical
    c.add(caixa(0.9, 0.1, 0.75, aco, 0, 1.82, -2.08));
    c.add(caixa(0.9, 0.1, 0.75, aco, 0, 0.68, -2.08));
    c.add(caixa(1.1, 1.05, 0.12, aco, 0, 1.25, -1.72)); // chapa de fundo, encostada na traseira
    const pinoGiro = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.3, 12), cromo);
    pinoGiro.position.set(0, 1.25, -2.25);
    c.add(pinoGiro);
    this.giroG.position.set(0, 1.2, -2.25);
    c.add(this.giroG);
    // coluna de giro (gira no pino) com as orelhas onde a lança se apoia
    this.giroG.add(caixa(0.56, 1.0, 0.42, amarelo, 0, 0.05, -0.05));
    for (const lado of [-1, 1]) this.giroG.add(caixa(0.06, 0.5, 0.45, amarelo, lado * 0.22, 0.32, -0.3));
    pino(this.giroG, cilindroX(0.11, 0.56, cromo, 12), 0, 0.35, -0.42);
    this.lancaG.position.set(0, 0.35, -0.42);
    this.giroG.add(this.lancaG);
    // lança em "banana": uma peça só, do pino da coluna até o pino do braço
    this.lancaG.add(viga([
      [-0.18, 0.2], [0.5, 0.62], [1.25, 0.85], [2.0, 0.55], [2.88, 0.2],
      [2.88, -0.2], [2.0, 0.12], [1.25, 0.38], [0.5, 0.18], [-0.18, -0.2],
    ], 0.28, amarelo));
    pino(this.lancaG, cilindroX(0.11, 0.42, cromo, 12), 0, 0, -2.7);
    this.bracoG.position.set(0, 0, -2.7);
    this.lancaG.add(this.bracoG);
    // braço com a "cauda" atrás do pino, onde empurra o cilindro
    this.bracoG.add(viga([
      [-0.58, 0.48], [-0.35, 0.5], [0.25, 0.2], [2.12, 0.12],
      [2.12, -0.14], [0.25, -0.2], [-0.35, 0.05], [-0.58, 0.25],
    ], 0.24, amarelo));
    pino(this.bracoG, cilindroX(0.09, 0.66, cromo, 12), 0, 0, -2.0);
    this.conchaG.position.set(0, 0, -2.0);
    this.bracoG.add(this.conchaG);
    const cr = criarConcha(
      [[-0.05, 0.12], [0.08, 0.42], [0.4, 0.55], [0.75, 0.42], [0.95, 0.12], [1.02, -0.08]],
      0.05, 0.62, amarelo,
    );
    this.conchaG.add(cr);
    for (const lado of [-1, 1]) this.conchaG.add(caixa(0.04, 0.5, 0.35, amarelo, lado * 0.16, 0.22, -0.05)); // orelhas da concha
    for (let d = 0; d < 4; d++) {
      const dente = caixa(0.07, 0.05, 0.16, aco, -0.24 + d * 0.16, -0.1, -1.06);
      dente.rotation.x = 0.5;
      this.conchaG.add(dente);
    }
    this.retro = this.montarConcha(this.conchaG, [0, -0.1, -1.05], [0, 0.0, -0.55], [0, -1, -0.15], 0.3, [0.5, 0.32, 0.55], [0, 0.22, -0.55]);

    // ---- sapatas estabilizadoras ----
    for (const [sapata, lado] of [[this.sapataE, 1], [this.sapataD, -1]] as const) {
      sapata.position.set(lado * 0.85, 1.2, -1.95);
      c.add(sapata);
      const perna = caixa(0.2, 1.65, 0.24, amarelo, lado * 0.5, -0.65, 0);
      perna.rotation.z = lado * 0.66;
      sapata.add(perna);
      sapata.add(caixa(0.45, 0.08, 0.45, aco, lado * 1.0, -1.31, 0));
    }

    // ---- cilindros hidráulicos ----
    // cada um sai de uma orelha e chega em outra
    this.cilindros.push(
      new Cilindro(c, orelha(this.giroG, 0, -0.3, -0.35), orelha(this.lancaG, 0, 0.22, -1.1), 0.09, 1.05),
      new Cilindro(c, orelha(this.lancaG, 0, 0.92, -1.25), orelha(this.bracoG, 0, 0.42, 0.48), 0.08, 1.35),
      new Cilindro(c, orelha(this.bracoG, 0, 0.27, -0.45), orelha(this.conchaG, 0, 0.42, -0.02), 0.07, 0.95),
    );
    for (const lado of [-1, 1]) {
      this.cilindros.push(new Cilindro(c, ancora(c, lado * 0.92, 1.15, 0.75), ancora(this.bracoFrenteG, lado * 0.95, -0.15, 1.5), 0.08, 1.0));
    }

    this.atualizarPose();
  }

  private montarConcha(
    pivo: THREE.Group,
    ponta: [number, number, number],
    boca: [number, number, number],
    abertura: [number, number, number],
    capacidade: number,
    tamanhoTerra: [number, number, number],
    posTerra: [number, number, number],
  ): Concha {
    const p = ancora(pivo, ...ponta);
    const b = ancora(pivo, ...boca);
    const terra = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), materialTerra);
    terra.scale.set(...tamanhoTerra);
    terra.position.set(...posTerra);
    terra.userData.escala = tamanhoTerra;
    terra.visible = false;
    terra.castShadow = true;
    pivo.add(terra);
    return { ponta: p, boca: b, abertura: new THREE.Vector3(...abertura).normalize(), pivo, terra, capacidade, carga: 0 };
  }

  // aplica os ângulos das articulações aos objetos
  atualizarPose(): void {
    this.giroG.rotation.y = this.giro;
    this.lancaG.rotation.x = this.lanca;
    this.bracoG.rotation.x = this.braco;
    this.conchaG.rotation.x = this.concha;
    this.bracoFrenteG.rotation.x = this.bracoFrente;
    // a concha da frente fica nivelada quando o braço sobe (como o paralelogramo das máquinas reais)
    this.conchaFrenteG.rotation.x = this.conchaFrente - this.bracoFrente;
    const s = this.sapatas;
    this.sapataE.rotation.z = (1 - s) * 2.2; // recolhida: dobrada para cima
    this.sapataD.rotation.z = -(1 - s) * 2.2;
    for (const conc of [this.retro, this.frente]) {
      const f = conc.carga / conc.capacidade;
      conc.terra.visible = f > 0.02;
      const e = conc.terra.userData.escala as [number, number, number];
      const k = Math.cbrt(f);
      conc.terra.scale.set(e[0] * Math.max(0.5, k), e[1] * k, e[2] * Math.max(0.5, k));
    }
    this.raiz.updateMatrixWorld(true);
    for (const cil of this.cilindros) cil.atualizar();
  }

  // direção (no mundo) para onde a concha está abrindo
  aberturaMundo(conc: Concha, alvo = new THREE.Vector3()): THREE.Vector3 {
    const q = conc.pivo.getWorldQuaternion(new THREE.Quaternion());
    return alvo.copy(conc.abertura).applyQuaternion(q);
  }
}
