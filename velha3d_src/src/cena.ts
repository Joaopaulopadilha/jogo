// A cena 3D (three.js): um tabuleiro de jogo da velha em relevo, com X e O volumosos, vistos de cima e de frente.
// Não conhece regras nem rede: recebe o estado e avisa onde tocaram.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface Ouvintes {
  escolher(i: number): void; // toque ou clique numa casa livre
  passar(i: number | null): void; // mouse sobre uma casa livre (null = saiu)
}

export interface DadosCena {
  cel: number[]; // 9 casas: 0 vazio, 1 = X, 2 = O
  linha: number[] | null; // linha vencedora
}

export const COR_X = 0x35d6bd;
export const COR_O = 0xff5470;
const OURO = 0xffc94a;

const PASSO = 2; // distância entre os centros das casas
const TOPO_CASA = 0.22; // altura do tampo de cada casa (onde as peças assentam)

// placa de cantos arredondados e bordas chanfradas, deitada: base em y = 0, topo em y = altura
function placa(larg: number, comp: number, altura: number, raio: number, chanfro: number): THREE.ExtrudeGeometry {
  const w = larg / 2 - chanfro;
  const h = comp / 2 - chanfro;
  const r = Math.max(0.01, Math.min(raio, w, h));
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.absarc(w - r, -h + r, r, -Math.PI / 2, 0, false);
  s.lineTo(w, h - r);
  s.absarc(w - r, h - r, r, 0, Math.PI / 2, false);
  s.lineTo(-w + r, h);
  s.absarc(-w + r, h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(-w, -h + r);
  s.absarc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5, false);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, altura - 2 * chanfro), bevelEnabled: true, bevelThickness: chanfro, bevelSize: chanfro, bevelSegments: 5, curveSegments: 14,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, chanfro, 0);
  return g;
}

function laqueado(cor: number, brilho = 0.08): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: cor, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.18, emissive: cor, emissiveIntensity: brilho });
}

// queda com quiques
function quica(x: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

const posicao = (i: number): THREE.Vector3 => new THREE.Vector3(((i % 3) - 1) * PASSO, TOPO_CASA, (Math.floor(i / 3) - 1) * PASSO);

export class Cena {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly observador: ResizeObserver;

  private readonly casas: THREE.Mesh[] = [];
  private readonly pecas = new Map<number, THREE.Group>();
  private readonly quedas = new Map<THREE.Group, number>(); // peça -> instante em que começou a cair
  private linha: number[] | null = null;
  private barra: THREE.Mesh | null = null;
  private barraDesde = 0;
  private fantasma: THREE.Group | null = null;
  private cel: number[] = Array<number>(9).fill(0);
  private permitir = false;
  private sujo = true;
  private raf = 0;
  private morta = false;
  private toqueIni: { x: number; y: number; t: number } | null = null;

  // geometrias e materiais compartilhados
  private readonly geoBarraX = placa(1.55, 0.36, 0.4, 0.17, 0.12);
  private readonly geoO = new THREE.TorusGeometry(0.5, 0.2, 32, 72);
  private readonly mat = {
    x: laqueado(COR_X),
    o: laqueado(COR_O),
    ouro: laqueado(OURO, 0.45),
    base: new THREE.MeshPhysicalMaterial({ color: 0x17223a, roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.35 }),
    casa: new THREE.MeshStandardMaterial({ color: 0x2b4068, roughness: 0.55, metalness: 0.1 }),
    casaSobre: new THREE.MeshStandardMaterial({ color: 0x3d5a91, roughness: 0.45, metalness: 0.1 }),
    grade: new THREE.MeshPhysicalMaterial({ color: 0xcdd9f2, roughness: 0.25, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.2 }),
    fantasmaX: new THREE.MeshStandardMaterial({ color: COR_X, transparent: true, opacity: 0.35, depthWrite: false }),
    fantasmaO: new THREE.MeshStandardMaterial({ color: COR_O, transparent: true, opacity: 0.35, depthWrite: false }),
  };

  constructor(private readonly canvas: HTMLCanvasElement, private readonly ouv: Ouvintes) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x1a1f2e, 1.15));
    const sol = new THREE.DirectionalLight(0xffffff, 1.9);
    sol.position.set(-4, 9, 5);
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    Object.assign(sol.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 25 });
    sol.shadow.bias = -0.0005;
    sol.shadow.normalBias = 0.02;
    this.scene.add(sol);
    const contra = new THREE.DirectionalLight(0x7fa4ff, 0.7);
    contra.position.set(6, 4, -6);
    this.scene.add(contra);

    this.montarTabuleiro();

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.rotateSpeed = 0.6;
    // gira um pouco para apreciar o relevo, sem nunca perder o tabuleiro de vista
    this.controls.minPolarAngle = 0.12;
    this.controls.maxPolarAngle = 1.12;
    this.controls.minAzimuthAngle = -0.85;
    this.controls.maxAzimuthAngle = 0.85;

    canvas.addEventListener("pointerdown", this.aoApertar);
    canvas.addEventListener("pointerup", this.aoSoltar);
    canvas.addEventListener("pointermove", this.aoMover);
    canvas.addEventListener("pointerleave", this.aoSair);

    this.observador = new ResizeObserver(() => this.redimensionar());
    this.observador.observe(canvas.parentElement ?? canvas);
    this.redimensionar();
    this.raf = requestAnimationFrame(this.quadro);
  }

  private montarTabuleiro(): void {
    const base = new THREE.Mesh(placa(6.9, 6.9, 0.55, 0.55, 0.16), this.mat.base);
    base.position.y = -0.55;
    base.receiveShadow = true;
    this.scene.add(base);

    const geoCasa = placa(1.76, 1.76, TOPO_CASA, 0.24, 0.07);
    for (let i = 0; i < 9; i++) {
      const casa = new THREE.Mesh(geoCasa, this.mat.casa);
      const p = posicao(i);
      casa.position.set(p.x, 0, p.z);
      casa.receiveShadow = true;
      casa.userData.i = i;
      this.scene.add(casa);
      this.casas.push(casa);
    }

    // a grade em "#", saltada entre as casas
    const geoBarra = placa(0.17, 5.9, 0.46, 0.08, 0.07);
    for (const k of [-1, 1]) {
      const emPe = new THREE.Mesh(geoBarra, this.mat.grade);
      emPe.position.x = (k * PASSO) / 2;
      const deitada = new THREE.Mesh(geoBarra, this.mat.grade);
      deitada.rotation.y = Math.PI / 2;
      deitada.position.set(0, 0.003, (k * PASSO) / 2); // um fio acima, para as duas não brigarem no cruzamento
      for (const m of [emPe, deitada]) { m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
    }

    // sombra suave do tabuleiro no "chão"
    const chao = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.35 }));
    chao.rotation.x = -Math.PI / 2;
    chao.position.y = -0.56;
    chao.receiveShadow = true;
    this.scene.add(chao);
  }

  private criarPeca(jogador: 1 | 2, material: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    if (jogador === 1) {
      for (const k of [-1, 1]) {
        const b = new THREE.Mesh(this.geoBarraX, material);
        b.rotation.y = (k * Math.PI) / 4;
        if (k > 0) b.position.y = 0.004;
        g.add(b);
      }
    } else {
      const anel = new THREE.Mesh(this.geoO, material);
      anel.rotation.x = -Math.PI / 2;
      anel.position.y = 0.2;
      g.add(anel);
    }
    g.userData.jogador = jogador;
    return g;
  }

  private pintar(g: THREE.Group, material: THREE.Material): void {
    for (const f of g.children) (f as THREE.Mesh).material = material;
  }

  // ---------------- API ----------------

  atualizar(d: DadosCena): void {
    this.cel = d.cel;
    // tira as peças que sumiram (nova partida) e põe as novas, caindo do alto
    for (const [i, g] of [...this.pecas]) {
      if (d.cel[i] !== g.userData.jogador) { this.scene.remove(g); this.pecas.delete(i); this.quedas.delete(g); }
    }
    d.cel.forEach((v, i) => {
      if ((v !== 1 && v !== 2) || this.pecas.has(i)) return;
      const g = this.criarPeca(v, v === 1 ? this.mat.x : this.mat.o);
      for (const f of g.children) { f.castShadow = true; f.receiveShadow = true; }
      g.position.copy(posicao(i)).setY(TOPO_CASA + 4);
      this.scene.add(g);
      this.pecas.set(i, g);
      this.quedas.set(g, performance.now());
    });

    const antes = this.linha?.join();
    this.linha = d.linha;
    if (antes !== d.linha?.join()) this.refazerBarra();
    this.pecas.forEach((g, i) => {
      const venceu = !!d.linha?.includes(i);
      this.pintar(g, venceu ? this.mat.ouro : g.userData.jogador === 1 ? this.mat.x : this.mat.o);
      if (!venceu && !this.quedas.has(g)) { g.position.y = TOPO_CASA; g.rotation.y = 0; }
    });
    if (this.fantasma && this.cel[this.fantasma.userData.i as number] !== 0) this.definirPreview(null, 1);
    this.sujo = true;
  }

  permitirJogar(v: boolean): void {
    this.permitir = v;
    if (!v) this.definirPreview(null, 1);
  }

  // peça translúcida na casa sob o mouse
  definirPreview(i: number | null, jogador: 1 | 2): void {
    if (this.fantasma) { this.scene.remove(this.fantasma); this.fantasma = null; }
    for (const c of this.casas) c.material = this.mat.casa;
    if (i !== null && this.cel[i] === 0) {
      const g = this.criarPeca(jogador, jogador === 1 ? this.mat.fantasmaX : this.mat.fantasmaO);
      g.position.copy(posicao(i));
      g.userData.i = i;
      this.scene.add(g);
      this.fantasma = g;
      this.casas[i].material = this.mat.casaSobre;
    }
    this.canvas.style.cursor = this.fantasma ? "pointer" : "";
    this.sujo = true;
  }

  // vista inicial: um pouco inclinada, na distância em que o tabuleiro inteiro cabe na tela
  resetarCamera(): void {
    const meioV = Math.tan((this.camera.fov * Math.PI) / 360);
    const distancia = Math.max(3.85 / (meioV * this.camera.aspect), 4.5 / meioV); // em pé manda a largura; deitado, a altura (com folga para o placar)
    const inclinacao = 0.62; // ângulo a partir da vertical
    this.camera.position.set(0, Math.cos(inclinacao) * distancia, Math.sin(inclinacao) * distancia);
    this.controls.target.set(0, 0, 0.15);
    this.controls.minDistance = distancia * 0.75;
    this.controls.maxDistance = distancia * 1.35;
    this.controls.update();
    this.sujo = true;
  }

  destruir(): void {
    this.morta = true;
    cancelAnimationFrame(this.raf);
    this.observador.disconnect();
    this.canvas.removeEventListener("pointerdown", this.aoApertar);
    this.canvas.removeEventListener("pointerup", this.aoSoltar);
    this.canvas.removeEventListener("pointermove", this.aoMover);
    this.canvas.removeEventListener("pointerleave", this.aoSair);
    this.controls.dispose();
    this.scene.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const m of Object.values(this.mat)) m.dispose();
    this.renderer.dispose();
  }

  // barra dourada atravessando as três peças vencedoras
  private refazerBarra(): void {
    if (this.barra) {
      this.scene.remove(this.barra);
      this.barra.geometry.dispose();
      this.barra = null;
    }
    if (!this.linha) return;
    const a = posicao(this.linha[0]);
    const b = posicao(this.linha[2]);
    const dir = b.clone().sub(a).normalize();
    const comp = a.distanceTo(b) + 1.5;
    const barra = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, comp, 8, 20), this.mat.ouro);
    barra.position.copy(a).add(b).multiplyScalar(0.5).setY(TOPO_CASA + 0.95);
    barra.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    barra.scale.y = 0.001;
    barra.castShadow = true;
    this.scene.add(barra);
    this.barra = barra;
    this.barraDesde = performance.now();
  }

  // ---------------- toque e mouse ----------------

  private casaEm(ev: PointerEvent): number | null {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    // onde o raio fura o plano do tampo das casas: vale a casa inteira, inclusive em cima da grade perto dela
    const p = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOPO_CASA), new THREE.Vector3());
    if (!p) return null;
    const col = Math.round(p.x / PASSO) + 1;
    const lin = Math.round(p.z / PASSO) + 1;
    if (col < 0 || col > 2 || lin < 0 || lin > 2) return null;
    const i = lin * 3 + col;
    return this.cel[i] === 0 ? i : null;
  }

  private aoApertar = (ev: PointerEvent): void => {
    this.toqueIni = { x: ev.clientX, y: ev.clientY, t: performance.now() };
  };

  // toque rápido e parado = jogar; arrastar = girar a vista (isso quem trata é o OrbitControls)
  private aoSoltar = (ev: PointerEvent): void => {
    const ini = this.toqueIni;
    this.toqueIni = null;
    if (!ini || !this.permitir) return;
    if (Math.hypot(ev.clientX - ini.x, ev.clientY - ini.y) > 10 || performance.now() - ini.t > 700) return;
    const i = this.casaEm(ev);
    if (i !== null) this.ouv.escolher(i);
  };

  private aoMover = (ev: PointerEvent): void => {
    if (ev.pointerType !== "mouse" || ev.buttons !== 0 || !this.permitir) return;
    this.ouv.passar(this.casaEm(ev));
  };

  private aoSair = (): void => {
    this.ouv.passar(null);
  };

  // ---------------- laço de desenho ----------------

  private redimensionar(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.controls) this.resetarCamera();
  }

  private quadro = (t: number): void => {
    if (this.morta) return;
    this.raf = requestAnimationFrame(this.quadro);
    let mudou = this.controls.update();
    for (const [g, t0] of this.quedas) {
      const k = Math.min(1, Math.max(0, (t - t0) / 650));
      g.position.y = TOPO_CASA + 4 * (1 - quica(k));
      g.rotation.y = (1 - Math.min(1, k * 1.6)) * 1.4; // gira um pouco enquanto cai
      mudou = true;
      if (k >= 1) { g.position.y = TOPO_CASA; g.rotation.y = 0; this.quedas.delete(g); }
    }
    if (this.linha) {
      this.linha.forEach((i, n) => {
        const g = this.pecas.get(i);
        if (g && !this.quedas.has(g)) g.position.y = TOPO_CASA + 0.16 + 0.14 * Math.sin(t / 220 - n * 0.9); // as vencedoras sobem em onda
      });
      if (this.barra) this.barra.scale.y = Math.min(1, Math.max(0.001, (t - this.barraDesde - 250) / 450));
      mudou = true;
    }
    if (mudou || this.sujo) {
      this.renderer.render(this.scene, this.camera);
      this.sujo = false;
    }
  };
}
