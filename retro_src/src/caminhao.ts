import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { materialTerra } from "./maquina";
import { Bloco, caixa as bloco } from "./colisao";

// Caminhão basculante 6x4 (cabine avançada): dirigível, com a caçamba onde a terra da concha é contada.
// Eixos do corpo: frente = +z, cima = +y, esquerda = +x (a porta do motorista). O chão fica em y = 0.

const tinta = new THREE.MeshStandardMaterial({ color: "#b3261b", roughness: 0.38, metalness: 0.25 });
const tintaEscura = new THREE.MeshStandardMaterial({ color: "#7d1a12", roughness: 0.5, metalness: 0.2 });
const branco = new THREE.MeshStandardMaterial({ color: "#ece9e2", roughness: 0.45, metalness: 0.1 });
const laranja = new THREE.MeshStandardMaterial({ color: "#e0771a", roughness: 0.5, metalness: 0.25 });
const laranjaEscuro = new THREE.MeshStandardMaterial({ color: "#a9540d", roughness: 0.6, metalness: 0.2 });
const aco = new THREE.MeshStandardMaterial({ color: "#2a2c30", roughness: 0.6, metalness: 0.55 });
const acoClaro = new THREE.MeshStandardMaterial({ color: "#6b7077", roughness: 0.5, metalness: 0.6 });
const cromo = new THREE.MeshStandardMaterial({ color: "#d9dee2", roughness: 0.2, metalness: 0.95 });
const borracha = new THREE.MeshStandardMaterial({ color: "#141414", roughness: 0.95 });
const preto = new THREE.MeshStandardMaterial({ color: "#1b1c1f", roughness: 0.7 });
const vidro = new THREE.MeshStandardMaterial({ color: "#7fa7c0", roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.32 });
const assento = new THREE.MeshStandardMaterial({ color: "#2c2f33", roughness: 0.85 });
const farol = new THREE.MeshStandardMaterial({ color: "#fff6d8", emissive: "#fff2c0", emissiveIntensity: 0.7 });
const pisca = new THREE.MeshStandardMaterial({ color: "#ff9a1f", emissive: "#a35200", emissiveIntensity: 0.6 });
const lanterna = new THREE.MeshStandardMaterial({ color: "#d01818", emissive: "#7a0a0a", emissiveIntensity: 0.6 });
const faixa = new THREE.MeshStandardMaterial({ color: "#f2cf10", roughness: 0.5 });

function caixa(w: number, h: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0, pai?: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  pai?.add(m);
  return m;
}

function arredondada(w: number, h: number, l: number, raio: number, mat: THREE.Material, x: number, y: number, z: number, pai: THREE.Object3D): THREE.Mesh {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, l, 3, raio), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  pai.add(m);
  return m;
}

// cilindro com o eixo ao longo de x, y ou z
function cilindro(raio: number, comp: number, mat: THREE.Material, eixo: "x" | "y" | "z", x: number, y: number, z: number, pai: THREE.Object3D, seg = 14): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(raio, raio, comp, seg), mat);
  if (eixo === "x") m.rotation.z = Math.PI / 2;
  if (eixo === "z") m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  pai.add(m);
  return m;
}

// roda: pneu de perfil arredondado com sulcos, aro e cubo; gira em torno do eixo x
function criarRoda(raio: number, largura: number): THREE.Group {
  const roda = new THREE.Group();
  const meia = largura / 2;
  const r = raio;
  const perfil: THREE.Vector2[] = [new THREE.Vector2(r * 0.58, -meia)];
  perfil.push(new THREE.Vector2(r * 0.9, -meia * 0.98), new THREE.Vector2(r * 0.98, -meia * 0.8));
  const sulcos = 5;
  for (let n = 0; n <= sulcos; n++) {
    const t = -meia * 0.7 + (n / sulcos) * meia * 1.4;
    perfil.push(new THREE.Vector2(r, t - meia * 0.09), new THREE.Vector2(r * 0.955, t), new THREE.Vector2(r, t + meia * 0.09));
  }
  perfil.push(new THREE.Vector2(r * 0.98, meia * 0.8), new THREE.Vector2(r * 0.9, meia * 0.98), new THREE.Vector2(r * 0.58, meia));
  const pneu = new THREE.Mesh(new THREE.LatheGeometry(perfil, 30), borracha);
  pneu.rotation.z = Math.PI / 2; // o torno gira em y: deita para o eixo ficar em x
  pneu.castShadow = true;
  roda.add(pneu);
  const aro = cilindro(r * 0.58, largura * 0.92, acoClaro, "x", 0, 0, 0, roda, 22);
  aro.castShadow = false;
  cilindro(r * 0.3, largura * 0.98, aco, "x", 0, 0, 0, roda, 10);
  for (let n = 0; n < 8; n++) {
    const a = (n / 8) * Math.PI * 2;
    const parafuso = cilindro(r * 0.035, largura * 1.0, cromo, "x", 0, Math.sin(a) * r * 0.2, Math.cos(a) * r * 0.2, roda, 6);
    parafuso.castShadow = false;
  }
  return roda;
}

export interface RodaCam {
  obj: THREE.Group; // gira em torno de x (rolando)
  pivo: THREE.Group; // gira em y (esterço, só as dianteiras)
  raio: number;
  dianteira: boolean;
}

export class Caminhao {
  readonly grupo = new THREE.Group(); // posição e rumo no mundo
  readonly corpo = new THREE.Group(); // inclinação sobre o terreno
  readonly entreEixos = 3.6; // eixo da frente até o meio do truque traseiro
  readonly rodas: RodaCam[] = [];
  readonly banco = new THREE.Group(); // onde o motorista senta
  readonly assentoPos = new THREE.Object3D(); // olhos do motorista (câmera da cabine)
  readonly porta = new THREE.Vector3(1.3, 0, 1.85); // porta do motorista (lado esquerdo, +x)
  volume = 0;
  readonly cacamba = { x: 1.1, z0: -2.7, z1: 0.8, piso: 1.4, borda: 2.2 };
  inclinacao = 0; // basculamento da caçamba, em radianos (0 = deitada; sobe pela frente, girando na dobradiça de trás)
  static readonly INCLINACAO_MAX = 0.95;
  private readonly cacambaG = new THREE.Group(); // gira na dobradiça traseira
  private readonly conteudo = new THREE.Group(); // tudo o que basculou: piso, paredes, terra
  private readonly dobradica = new THREE.Vector3(0, 1.2, -2.85);
  private camisa!: THREE.Mesh; // cilindro hidráulico (corpo fixo e haste que acompanha a caçamba)
  private haste!: THREE.Mesh;
  private readonly terra: THREE.Mesh;
  private readonly local = new THREE.Vector3();

  constructor(x: number, y: number, z: number, rumo: number) {
    const g = this.grupo;
    g.add(this.corpo);
    const c = this.corpo;
    const k = this.cacamba;

    this.chassi(c);
    this.cabine(c);
    this.cacambaG.position.copy(this.dobradica);
    this.conteudo.position.copy(this.dobradica).negate(); // as peças da caçamba ficam nas coordenadas do caminhão
    this.cacambaG.add(this.conteudo);
    c.add(this.cacambaG);
    this.caixaDeCarga(this.conteudo, k);
    this.cilindroHidraulico(c);
    this.rodasEMais(c);

    this.terra = new THREE.Mesh(new THREE.BoxGeometry(k.x * 2 - 0.05, 1, k.z1 - k.z0 - 0.05), materialTerra);
    this.terra.position.set(0, k.piso, (k.z0 + k.z1) / 2);
    this.terra.visible = false;
    this.terra.castShadow = true;
    this.conteudo.add(this.terra);
    this.aplicarInclinacao();

    g.position.set(x, y, z);
    g.rotation.y = rumo;
    g.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- chassi, tanques, escapamento
  private chassi(c: THREE.Group): void {
    // longarinas e travessas
    for (const lado of [-1, 1]) {
      caixa(0.14, 0.3, 6.5, aco, lado * 0.62, 0.95, -0.4, c);
      caixa(0.04, 0.22, 6.5, acoClaro, lado * 0.55, 0.95, -0.4, c);
    }
    for (const zt of [2.5, 0.9, -0.5, -1.9, -3.2]) caixa(1.3, 0.14, 0.14, aco, 0, 0.9, zt, c);
    // para-choque dianteiro com degrau
    arredondada(2.45, 0.34, 0.32, 0.06, aco, 0, 0.88, 2.84, c);
    caixa(2.3, 0.08, 0.34, cromo, 0, 1.06, 2.86, c);
    for (const lado of [-1, 1]) {
      caixa(0.3, 0.12, 0.08, farol, lado * 0.95, 0.9, 3.01, c); // farol auxiliar
      caixa(0.1, 0.06, 0.1, pisca, lado * 1.12, 1.06, 2.98, c);
    }
    // para-choque traseiro, reforço antiengavetamento
    caixa(2.3, 0.2, 0.22, aco, 0, 0.72, -3.55, c);
    caixa(2.32, 0.04, 0.24, faixa, 0, 0.84, -3.56, c);
    // tanque de diesel (esquerda) e de ar (direita)
    cilindro(0.34, 1.3, acoClaro, "z", 0.98, 0.9, 0.2, c, 18);
    cilindro(0.2, 0.9, preto, "z", -0.95, 0.88, 0.1, c, 14);
    for (const zc of [-0.2, 0.6]) caixa(0.08, 0.1, 0.05, aco, 0.98, 0.58, zc, c); // cintas
    // eixo cardã
    cilindro(0.05, 3.4, aco, "z", 0, 0.78, -0.6, c, 8);
    // eixos e diferenciais
    for (const zr of [1.7, -1.3, -2.5]) {
      cilindro(0.09, 2.1, aco, "x", 0, 0.55, zr, c, 10);
      if (zr < 0) {
        const dif = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), acoClaro);
        dif.position.set(0, 0.55, zr);
        dif.castShadow = true;
        c.add(dif);
      }
    }
    // feixe de molas
    for (const zr of [1.7, -1.3, -2.5]) for (const lado of [-1, 1]) caixa(0.1, 0.1, 1.1, aco, lado * 0.72, 0.72, zr, c);
    // escapamento vertical atrás da cabine (esquerda)
    cilindro(0.075, 1.7, cromo, "y", 1.12, 1.95, 0.88, c, 12);
    cilindro(0.1, 0.12, aco, "y", 1.12, 1.1, 0.88, c, 12);
    const cotovelo = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), cromo);
    cotovelo.position.set(1.12, 2.8, 0.88);
    c.add(cotovelo);
    cilindro(0.07, 0.3, cromo, "x", 1.12, 2.86, 0.88, c, 10).rotation.z = Math.PI / 2 + 0.6;
    // lameiras (para-barros) e para-lamas traseiros
    for (const lado of [-1, 1]) {
      caixa(0.55, 0.06, 2.3, tintaEscura, lado * 1.0, 1.2, -1.9, c);
      caixa(0.55, 0.03, 0.03, aco, lado * 1.0, 1.2, -3.07, c);
      caixa(0.5, 0.5, 0.05, borracha, lado * 1.0, 0.8, -3.15, c); // lameira
      caixa(0.45, 0.4, 0.04, borracha, lado * 1.0, 0.75, 1.15, c);
    }
  }

  // ---------------------------------------------------------------- cabine avançada
  private cabine(c: THREE.Group): void {
    const z0 = 1.85;
    // pé da cabine e carroceria
    arredondada(2.3, 1.45, 1.7, 0.11, tinta, 0, 1.97, z0, c);
    arredondada(2.34, 0.34, 1.74, 0.07, tintaEscura, 0, 1.38, z0, c); // saia
    // teto, defletor de ar e luzes de gabarito
    arredondada(2.2, 0.1, 1.55, 0.04, branco, 0, 2.74, z0, c);
    const defletor = arredondada(2.1, 0.16, 0.5, 0.05, branco, 0, 2.92, z0 - 0.15, c);
    defletor.rotation.x = 0.28;
    for (const x of [-0.7, 0, 0.7]) caixa(0.14, 0.07, 0.1, pisca, x, 2.8, z0 + 0.7, c);
    // para-brisa (levemente inclinado), moldura e limpadores
    const parabrisa = caixa(2.0, 0.78, 0.05, vidro, 0, 2.33, 2.7, c);
    parabrisa.rotation.x = -0.1;
    parabrisa.castShadow = false;
    caixa(2.06, 0.05, 0.07, aco, 0, 2.74, 2.69, c);
    caixa(2.06, 0.05, 0.07, aco, 0, 1.94, 2.7, c);
    for (const lado of [-1, 1]) caixa(0.05, 0.84, 0.07, aco, lado * 1.03, 2.34, 2.7, c);
    for (const x of [-0.5, 0.4]) caixa(0.03, 0.05, 0.6, preto, x, 1.99, 2.72, c).rotation.z = 0.5;
    // faixa branca em volta, abaixo das janelas
    caixa(2.32, 0.1, 1.72, branco, 0, 1.78, z0, c);
    // grade com travessas cromadas
    caixa(1.95, 0.55, 0.06, preto, 0, 1.46, 2.7, c);
    for (let n = 0; n < 5; n++) caixa(1.9, 0.03, 0.08, cromo, 0, 1.25 + n * 0.1, 2.72, c);
    caixa(0.5, 0.16, 0.05, branco, 0, 1.12, 2.72, c); // placa
    // faróis, piscas e retrovisores
    for (const lado of [-1, 1]) {
      arredondada(0.4, 0.2, 0.1, 0.05, farol, lado * 0.82, 1.56, 2.72, c);
      arredondada(0.4, 0.04, 0.12, 0.02, cromo, lado * 0.82, 1.68, 2.73, c);
      caixa(0.16, 0.1, 0.06, pisca, lado * 1.07, 1.56, 2.72, c);
      // retrovisor: haste e espelho
      caixa(0.05, 0.05, 0.4, aco, lado * 1.32, 2.28, 2.5, c);
      caixa(0.12, 0.55, 0.26, preto, lado * 1.5, 2.2, 2.5, c);
      caixa(0.04, 0.5, 0.22, acoClaro, lado * 1.5, 2.2, 2.5, c);
    }
    // portas: janela, fresta, maçaneta e degrau
    for (const lado of [-1, 1]) {
      const x = lado * 1.16;
      const janela = caixa(0.05, 0.62, 1.05, vidro, x, 2.33, z0 - 0.02, c);
      janela.castShadow = false;
      caixa(0.06, 0.04, 1.12, aco, x, 2.65, z0 - 0.02, c);
      caixa(0.06, 0.04, 1.12, aco, x, 2.0, z0 - 0.02, c);
      caixa(0.07, 1.4, 0.03, preto, x, 1.97, z0 + 0.58, c); // fresta da porta (frente)
      caixa(0.07, 1.4, 0.03, preto, x, 1.97, z0 - 0.72, c); // fresta da porta (trás)
      caixa(0.09, 0.07, 0.24, cromo, x, 1.88, z0 + 0.4, c); // maçaneta
      // degraus
      caixa(0.32, 0.05, 0.6, aco, lado * 1.3, 1.08, z0 - 0.05, c);
      caixa(0.28, 0.05, 0.5, aco, lado * 1.28, 0.74, z0 - 0.05, c);
      caixa(0.05, 0.4, 0.05, aco, lado * 1.42, 0.92, z0 - 0.05, c);
      // faixa de reflexivo
      caixa(0.04, 0.05, 1.5, faixa, lado * 1.17, 1.5, z0 - 0.02, c);
    }
    // detalhes do interior: painel, volante, banco do motorista
    caixa(1.9, 0.3, 0.45, preto, 0, 1.95, 2.45, c);
    const volante = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.025, 8, 20), preto);
    volante.position.set(0.5, 2.1, 2.2);
    volante.rotation.x = Math.PI / 2 - 0.5;
    c.add(volante);
    cilindro(0.03, 0.4, aco, "z", 0.5, 2.0, 2.28, c, 6).rotation.x = Math.PI / 2 - 0.5;
    // banco giratório do operário (o personagem senta nele); fica em y = piso da cabine + 0,25
    this.banco.position.set(0.5, 1.45, 1.75);
    c.add(this.banco);
    caixa(0.6, 0.14, 0.55, assento, 0, 0.27, 0, this.banco);
    caixa(0.6, 0.7, 0.12, assento, 0, 0.62, -0.3, this.banco);
    caixa(0.5, 0.1, 0.1, assento, 0, 1.0, -0.3, this.banco);
    caixa(0.5, 0.3, 0.55, preto, -1.0, 0.15, -0.05, this.banco); // banco do carona (junto à coluna)
    this.assentoPos.position.set(0.5, 2.6, 1.8);
    c.add(this.assentoPos);
    // piso da cabine
    caixa(2.1, 0.06, 1.55, preto, 0, 1.22, z0, c);
  }

  // ---------------------------------------------------------------- caçamba basculante
  private caixaDeCarga(c: THREE.Group, k: { x: number; z0: number; z1: number; piso: number; borda: number }): void {
    const comp = k.z1 - k.z0;
    const meio = (k.z0 + k.z1) / 2;
    const alt = k.borda - k.piso;
    // subquadro (o cilindro de basculamento é montado à parte: um lado fica no chassi e o outro na caçamba)
    caixa(2.4, 0.12, comp + 0.3, aco, 0, k.piso - 0.18, meio, c);
    for (const lado of [-1, 1]) caixa(0.1, 0.12, comp + 0.3, aco, lado * 0.8, k.piso - 0.28, meio, c);
    // piso reforçado e paredes
    caixa(k.x * 2 + 0.2, 0.12, comp + 0.2, laranjaEscuro, 0, k.piso - 0.06, meio, c);
    for (const lado of [-1, 1]) {
      caixa(0.1, alt, comp + 0.2, laranja, lado * (k.x + 0.05), k.piso + alt / 2, meio, c);
      // borda superior arredondada
      cilindro(0.09, comp + 0.2, laranja, "z", lado * (k.x + 0.05), k.borda + 0.02, meio, c, 10);
      // nervuras verticais
      for (let n = 0; n < 5; n++) caixa(0.07, alt + 0.04, 0.1, laranjaEscuro, lado * (k.x + 0.14), k.piso + alt / 2, k.z0 + 0.2 + n * (comp - 0.4) / 4, c);
      // faixa refletiva e luz lateral
      caixa(0.02, 0.07, comp * 0.8, faixa, lado * (k.x + 0.11), k.piso + 0.22, meio, c);
      caixa(0.06, 0.07, 0.12, pisca, lado * (k.x + 0.12), k.borda - 0.18, k.z0 + 0.1, c);
      caixa(0.06, 0.07, 0.12, pisca, lado * (k.x + 0.12), k.borda - 0.18, k.z1 - 0.1, c);
    }
    // parede da frente alta, com o protetor da cabine (aba que cobre o teto)
    caixa(k.x * 2 + 0.2, alt + 0.4, 0.1, laranja, 0, k.piso + (alt + 0.4) / 2, k.z1 + 0.05, c);
    for (let n = 0; n < 4; n++) caixa(0.12, alt + 0.3, 0.07, laranjaEscuro, -0.85 + n * 0.57, k.piso + (alt + 0.3) / 2, k.z1 + 0.13, c);
    const aba = caixa(k.x * 2 + 0.3, 0.08, 1.05, laranja, 0, k.borda + 0.7, k.z1 + 0.5, c);
    aba.rotation.x = -0.13;
    caixa(k.x * 2 + 0.3, 0.1, 0.1, laranjaEscuro, 0, k.borda + 0.74, k.z1 + 1.0, c);
    // tampa traseira com dobradiças, trava e lanternas
    caixa(k.x * 2 + 0.2, alt, 0.1, laranja, 0, k.piso + alt / 2, k.z0 - 0.05, c);
    for (let n = 0; n < 4; n++) caixa(0.12, alt - 0.05, 0.07, laranjaEscuro, -0.85 + n * 0.57, k.piso + alt / 2, k.z0 - 0.13, c);
    for (const lado of [-1, 1]) {
      cilindro(0.06, 0.18, aco, "x", lado * (k.x - 0.1), k.borda - 0.02, k.z0 - 0.06, c, 8); // dobradiça
      caixa(0.16, 0.1, 0.1, lanterna, lado * (k.x - 0.15), k.piso + 0.15, k.z0 - 0.15, c);
      caixa(0.1, 0.06, 0.1, pisca, lado * (k.x - 0.15), k.piso + 0.28, k.z0 - 0.15, c);
    }
    caixa(0.05, alt * 0.8, 0.05, aco, 0.5, k.piso + alt / 2, k.z0 - 0.14, c); // barra de trava
    caixa(0.35, 0.18, 0.04, branco, 0, k.piso + 0.12, k.z0 - 0.14, c); // placa
    caixa(k.x * 2 + 0.2, 0.06, 0.04, faixa, 0, k.piso + 0.52, k.z0 - 0.15, c);
  }

  // ---------------------------------------------------------------- rodas, para-lamas
  private rodasEMais(c: THREE.Group): void {
    const raio = 0.55;
    const posicoes: { x: number; z: number; larg: number; frente: boolean }[] = [
      { x: -1.03, z: 1.7, larg: 0.4, frente: true },
      { x: 1.03, z: 1.7, larg: 0.4, frente: true },
    ];
    for (const zr of [-1.3, -2.5]) {
      for (const lado of [-1, 1]) {
        posicoes.push({ x: lado * 0.78, z: zr, larg: 0.32, frente: false });
        posicoes.push({ x: lado * 1.2, z: zr, larg: 0.32, frente: false });
      }
    }
    for (const p of posicoes) {
      const pivo = new THREE.Group();
      pivo.position.set(p.x, raio, p.z);
      const obj = criarRoda(raio, p.larg);
      pivo.add(obj);
      c.add(pivo);
      this.rodas.push({ obj, pivo, raio, dianteira: p.frente });
    }
    // para-lamas dianteiros: arco meia-cana sobre cada roda
    for (const lado of [-1, 1]) {
      const arco = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.5, 20, 1, true, 0.25, Math.PI - 0.5), tinta);
      arco.material = tinta.clone();
      (arco.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      arco.rotation.z = Math.PI / 2;
      arco.position.set(lado * 1.03, raio, 1.7);
      arco.castShadow = true;
      c.add(arco);
      caixa(0.52, 0.04, 0.12, tinta, lado * 1.03, raio + 0.7, 2.32, c).rotation.x = 0.2;
    }
  }

  // ---------------------------------------------------------------- basculamento

  // cilindro hidráulico: o corpo prende no chassi e a haste vai até a caçamba, esticando conforme ela sobe
  private cilindroHidraulico(c: THREE.Group): void {
    this.camisa = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 1, 12), cromo);
    this.haste = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 1, 10), acoClaro);
    for (const m of [this.camisa, this.haste]) {
      m.castShadow = true;
      c.add(m);
    }
  }

  // aplica a inclinação ao modelo (caçamba e cilindro)
  aplicarInclinacao(): void {
    const k = this.cacamba;
    this.cacambaG.rotation.x = -this.inclinacao;
    if (!this.camisa) return;
    // ponto da caçamba onde o cilindro se prende (perto da frente, embaixo), depois de girar na dobradiça
    const dy = k.piso - 0.18 - this.dobradica.y;
    const dz = k.z1 - 0.3 - this.dobradica.z;
    const cos = Math.cos(this.inclinacao);
    const sen = Math.sin(this.inclinacao);
    const topo = new THREE.Vector2(this.dobradica.y + dy * cos + dz * sen, this.dobradica.z + dz * cos - dy * sen); // (y, z)
    const base = new THREE.Vector2(0.95, k.z1 - 0.3); // preso no chassi
    const dir = topo.clone().sub(base);
    const comp = dir.length();
    // dir está no plano (y, z): x = parte vertical, y = parte para a frente. O cilindro tem o eixo em y; girar em x por a leva
    // (0,1,0) para (0, cos a, sin a)
    const rotX = Math.atan2(dir.y / comp, dir.x / comp);
    for (const [m, de, ate] of [[this.camisa, 0, comp * 0.55], [this.haste, comp * 0.5, comp]] as const) {
      const centro = base.clone().addScaledVector(dir, (de + ate) / 2 / comp);
      m.position.set(0, centro.x, centro.y);
      m.rotation.set(rotX, 0, 0);
      m.scale.set(1, ate - de, 1);
    }
  }

  // ponto da beira traseira da caçamba, no mundo (por onde a terra escorre ao bascular)
  beiraTraseira(alvo = new THREE.Vector3()): THREE.Vector3 {
    const k = this.cacamba;
    return this.conteudo.localToWorld(alvo.set(0, k.piso + 0.1, k.z0 - 0.15));
  }

  // ---------------------------------------------------------------- colisão, carga

  // blocos de colisão no mundo: base com o piso da caçamba (o topo sobe com a terra), paredes, cabine e para-choque
  blocos(): Bloco[] {
    const c = this.cacamba;
    const g = this.grupo;
    const y = g.position.y;
    const r = g.rotation.y;
    const parte = (lx: number, lz: number, hx: number, hz: number, y0: number, y1: number) => {
      const p = g.localToWorld(new THREE.Vector3(lx, 0, lz));
      return bloco(p.x, p.z, r, hx, hz, y + y0, y + y1);
    };
    const meio = (c.z0 + c.z1) / 2;
    const meioComp = (c.z1 - c.z0) / 2 + 0.1;
    if (this.inclinacao > 0.12) {
      // caçamba levantada: só o chassi, o subquadro e a cabine ficam sólidos
      return [
        parte(0, meio, c.x + 0.1, meioComp, 0, c.piso - 0.2),
        parte(0, 1.9, 1.2, 0.95, 0, 2.7), // cabine
        parte(0, -3.15, 0.8, 0.35, 0, 1.15), // ponta do chassi atrás
      ];
    }
    return [
      parte(0, meio, c.x + 0.1, meioComp, 0, c.piso + this.alturaTerra()), // por baixo e o piso (ou a terra)
      parte(c.x + 0.075, meio, 0.075, meioComp, 0, c.borda), // parede esquerda
      parte(-c.x - 0.075, meio, 0.075, meioComp, 0, c.borda), // parede direita
      parte(0, c.z0 - 0.05, c.x + 0.15, 0.06, 0, c.borda), // tampa traseira
      parte(0, c.z1 + 0.05, c.x + 0.15, 0.06, 0, c.borda + 0.4), // parede da frente (mais alta)
      parte(0, 1.9, 1.2, 0.95, 0, 2.7), // cabine
      parte(0, -3.15, 0.8, 0.35, 0, 1.15), // ponta do chassi atrás
    ];
  }

  alturaTerra(): number {
    const c = this.cacamba;
    return Math.min(this.volume / (c.x * 2 * (c.z1 - c.z0)), c.borda - c.piso + 0.4);
  }

  // a partícula caiu dentro da caçamba? (então fica aqui e é contada)
  pegar(p: THREE.Vector3, volume: number): boolean {
    if (this.inclinacao > 0.12) return false; // levantada, a terra cai no chão
    const c = this.cacamba;
    this.grupo.worldToLocal(this.local.copy(p));
    const l = this.local;
    if (Math.abs(l.x) > c.x || l.z < c.z0 || l.z > c.z1) return false;
    if (l.y > c.piso + this.alturaTerra() + 0.05 || l.y < c.piso - 0.4) return false;
    this.definirVolume(this.volume + volume);
    return true;
  }

  definirVolume(volume: number): void {
    const c = this.cacamba;
    this.volume = volume;
    const h = this.alturaTerra();
    this.terra.visible = h > 0.01;
    this.terra.scale.y = Math.max(h, 0.01);
    this.terra.position.y = c.piso + h / 2;
  }

  // altura da superfície da caçamba (piso ou terra) no ponto, ou null se o ponto não está sobre ela
  superficie(x: number, z: number): number | null {
    if (this.inclinacao > 0.12) return null;
    const c = this.cacamba;
    const l = this.grupo.worldToLocal(this.local.set(x, this.grupo.position.y, z));
    if (Math.abs(l.x) > c.x || l.z < c.z0 || l.z > c.z1) return null;
    return this.grupo.position.y + c.piso + this.alturaTerra();
  }
}
