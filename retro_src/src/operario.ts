import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Operário: modelo do Meshy com esqueleto e animações feitas no Blender (modelos/operario.py).
// Animações: parado, andar, correr, agachado, agachado_andar, pulo, sentado. Frente do modelo = +z.
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
  private atual = "";

  async carregar(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url);
    const modelo = gltf.scene;
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
    const acao = this.acoes.get(nome);
    if (!acao) {
      this.atual = nome; // ainda carregando: toca quando chegar
      return;
    }
    acao.timeScale = escala;
    if (nome === this.atual) return;
    const antiga = this.acoes.get(this.atual);
    acao.reset().play();
    if (antiga && mistura > 0) acao.crossFadeFrom(antiga, mistura, false);
    else if (antiga) antiga.stop();
    this.atual = nome;
  }

  atualizar(dt: number): void {
    this.mixer?.update(dt);
  }
}
