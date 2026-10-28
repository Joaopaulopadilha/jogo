import * as THREE from "three";
import { Terreno } from "./terreno";
import { Caminhao } from "./cenario";

interface Torrao {
  p: THREE.Vector3;
  v: THREE.Vector3;
  volume: number; // m³ que viram terreno (ou carga do caminhão) quando o torrão pousa
  giro: number;
  tamanho: number;
}

// Torrões de terra caindo da concha. Ao tocar o chão, viram terreno; na caçamba, contam para a missão.
export class Particulas {
  readonly malha: THREE.InstancedMesh;
  private readonly lista: Torrao[] = [];
  private readonly max = 900;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();

  constructor() {
    const geo = new THREE.DodecahedronGeometry(0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: "#6e4b2a", roughness: 1 });
    this.malha = new THREE.InstancedMesh(geo, mat, this.max);
    this.malha.castShadow = true;
    this.malha.count = 0;
    this.malha.frustumCulled = false;
  }

  emitir(p: THREE.Vector3, v: THREE.Vector3, volume: number, tamanho = 0.16): void {
    if (this.lista.length >= this.max) {
      // cheio: o mais antigo pousa onde está para não perder terra
      this.lista.shift();
    }
    this.lista.push({ p: p.clone(), v: v.clone(), volume, giro: Math.random() * 6, tamanho: tamanho * (0.7 + Math.random() * 0.6) });
  }

  // devolve o volume que entrou no caminhão neste quadro
  atualizar(dt: number, terreno: Terreno, caminhao: Caminhao): number {
    let noCaminhao = 0;
    for (let n = this.lista.length - 1; n >= 0; n--) {
      const t = this.lista[n];
      t.v.y -= 9.8 * dt;
      t.p.addScaledVector(t.v, dt);
      t.giro += dt * 5;
      if (t.volume > 0 && caminhao.pegar(t.p, t.volume)) {
        noCaminhao += t.volume;
        this.lista.splice(n, 1);
        continue;
      }
      const h = terreno.altura(t.p.x, t.p.z);
      if (t.p.y <= h) {
        if (t.volume > 0) terreno.depositar(t.p.x, t.p.z, t.volume, 0.6);
        this.lista.splice(n, 1);
      }
    }
    for (let n = 0; n < this.lista.length; n++) {
      const t = this.lista[n];
      this.q.setFromEuler(this.e.set(t.giro, t.giro * 0.7, 0));
      this.m.compose(t.p, this.q, this.s.setScalar(t.tamanho));
      this.malha.setMatrixAt(n, this.m);
    }
    this.malha.count = this.lista.length;
    this.malha.instanceMatrix.needsUpdate = true;
    return noCaminhao;
  }
}
