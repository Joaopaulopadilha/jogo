import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as clonarComEsqueleto } from "three/examples/jsm/utils/SkeletonUtils.js";
import { criarArma } from "./arma";

// o modelo é baixado uma vez e cada operário (o seu e os dos outros jogadores) recebe uma cópia
const modelos = new Map<string, Promise<GLTF>>();

// Operário: modelo do Meshy com esqueleto e animações feitas no Blender (modelos/operario.py).
// Animações: parado, andar, correr, agachado, agachado_andar, pulo, sentado. Frente do modelo = +z.
// "carrinho" (escorregada de futebol) usa a animação agachado com o corpo inclinado para trás.
export class Operario {
  readonly grupo = new THREE.Group();
  x = 0;
  z = 0;
  rumo = 0;
  vel = 0;
  y = 0; // altura dos pés no mundo (sobe no pulo)
  vy = 0;
  noChao = true;
  agachado = false;
  carregado = false;
  private mixer: THREE.AnimationMixer | null = null;
  private readonly acoes = new Map<string, THREE.AnimationAction>();
  atual = ""; // animação tocando (os outros jogadores recebem pelo nome)
  escala = 1; // velocidade da animação pedida por último
  private inclinacao = 0; // quanto o corpo está inclinado para trás (carrinho)

  // fuzil: ligada = nas mãos; pitch = quanto o cano aponta para cima (rad); coice = 1 logo após um tiro e cai a 0
  readonly arma = { ligada: false, mirando: false, pitch: 0, coice: 0, recarga: 0 }; // recarga: 0 (não) ou 0 a 1 (andamento)
  esconderCorpoAoMirar = false; // o seu próprio operário some ao mirar (a câmera vai para a mira da arma)
  private armaObj: THREE.Group | null = null;
  private readonly ossos = new Map<string, THREE.Object3D>();
  private readonly repouso = new Map<string, THREE.Quaternion>();
  private readonly tmp = { q: new THREE.Quaternion(), e: new THREE.Euler(), a: new THREE.Vector3(), b: new THREE.Vector3() };

  constructor() {
    void criarArma().then((g) => {
      g.visible = false;
      g.rotation.order = "YXZ";
      this.armaObj = g;
      this.grupo.add(g);
    });
  }

  // posição no mundo de um ponto da arma (boca do cano, olho da mira)
  pontoDaArma(local: THREE.Vector3, saida: THREE.Vector3): THREE.Vector3 {
    this.armaObj?.updateWorldMatrix(true, false);
    return this.armaObj ? this.armaObj.localToWorld(saida.copy(local)) : saida.copy(local);
  }

  private modelo: THREE.Object3D | null = null;
  private pedido = ""; // modelo pedido por último (vale só o último, se vários pedidos chegarem juntos)

  // carrega o modelo (ou troca pelo novo, mantendo a animação que estava tocando)
  async carregar(url: string): Promise<void> {
    this.pedido = url;
    if (!modelos.has(url)) modelos.set(url, new GLTFLoader().loadAsync(url));
    const gltf = await modelos.get(url)!;
    if (this.pedido !== url) return;
    if (this.modelo) {
      this.grupo.remove(this.modelo);
      this.mixer?.stopAllAction();
      this.acoes.clear();
    }
    const modelo = clonarComEsqueleto(gltf.scene);
    this.modelo = modelo;
    this.ossos.clear();
    this.repouso.clear();
    modelo.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        this.ossos.set(o.name, o);
        this.repouso.set(o.name, o.quaternion.clone()); // pose de repouso (as animações giram a partir dela)
      }
    });
    modelo.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // malha com esqueleto: a caixa de recorte não acompanha a animação
      }
    });
    this.grupo.add(modelo);
    this.mixer = new THREE.AnimationMixer(modelo);
    for (const clip of gltf.animations) this.acoes.set(clip.name, this.mixer.clipAction(clip));
    this.carregado = true;
    const pedida = this.atual || "parado";
    this.atual = "";
    this.tocar(pedida, 0);
  }

  // troca de animação com mistura suave; escala = velocidade da animação
  tocar(nome: string, mistura = 0.25, escala = 1): void {
    const clipe = (n: string): string => (n === "carrinho" ? "agachado" : n);
    const acao = this.acoes.get(clipe(nome));
    if (!acao) {
      this.atual = nome; // ainda carregando: toca quando chegar
      return;
    }
    this.escala = escala;
    acao.timeScale = escala;
    if (nome === this.atual) return;
    const antiga = this.acoes.get(clipe(this.atual));
    if (antiga === acao) {
      this.atual = nome; // mesma animação (agachado <-> carrinho): só muda a inclinação
      return;
    }
    acao.reset().play();
    if (antiga && mistura > 0) acao.crossFadeFrom(antiga, mistura, false);
    else if (antiga) antiga.stop();
    this.atual = nome;
  }

  // gira um osso a partir da pose de repouso (rotação em X do osso = dobrar para a frente, como nas animações do Blender)
  private osso(nome: string, rx: number, ry = 0, rz = 0): void {
    const o = this.ossos.get(nome);
    const r = this.repouso.get(nome);
    if (!o || !r) return;
    o.quaternion.copy(r).multiply(this.tmp.q.setFromEuler(this.tmp.e.set(rx, ry, rz)));
  }

  // com o fuzil ligado: braços seguram a arma (por cima da animação) e ela aponta para onde `arma.pitch` manda
  private atualizarArma(dt: number): void {
    const a = this.armaObj;
    if (!a) return;
    const ligada = this.arma.ligada && this.ossos.has("mao_d");
    a.visible = ligada;
    if (this.modelo) this.modelo.visible = !(ligada && this.arma.mirando && this.esconderCorpoAoMirar);
    const reddot = a.getObjectByName("reddot");
    if (reddot) reddot.visible = !(this.arma.mirando && this.esconderCorpoAoMirar);
    this.arma.coice = Math.max(0, this.arma.coice - dt * 9);
    if (!ligada) return;
    const p = this.arma.pitch;
    this.osso("coluna", 0.05);
    this.osso("braco_d", 1.2 + p * 0.9, 0.0, 0.1);
    this.osso("antebraco_d", 0.5, 0, 0);
    this.osso("braco_e", 1.3 + p * 0.9, 0, -0.45);
    this.osso("antebraco_e", 0.35, 0, 0);
    this.grupo.updateMatrixWorld(true);
    const t = this.tmp;
    const pulso = this.ossos.get("mao_d")!.getWorldPosition(t.a);
    const cotovelo = this.ossos.get("antebraco_d")!.getWorldPosition(t.b);
    const palma = pulso.clone().add(pulso.clone().sub(cotovelo).normalize().multiplyScalar(0.05));
    this.grupo.worldToLocal(palma);
    a.position.copy(palma);
    // recarregando: a arma desce e vira de lado, como quem troca o pente
    const troca = this.arma.recarga > 0 ? Math.sin(Math.PI * Math.min(1, this.arma.recarga)) : 0;
    a.position.z -= 0.035 * this.arma.coice;
    a.position.y -= 0.14 * troca;
    a.rotation.set(p + 0.04 * this.arma.coice - 0.55 * troca, Math.PI, 0.5 * troca);
  }

  atualizar(dt: number): void {
    this.mixer?.update(dt);
    this.inclinacao += ((this.atual === "carrinho" ? -1.05 : 0) - this.inclinacao) * Math.min(1, dt * 14);
    if (this.modelo) this.modelo.rotation.x = this.inclinacao;
    this.atualizarArma(dt);
  }
}
