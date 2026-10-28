import * as THREE from "three";

// Terreno de altura (heightmap) que pode ser cavado e aterrado.
// Grade de N×N vértices cobrindo TAMANHO×TAMANHO metros; índice = i*N + j (i no eixo z, j no eixo x).
export const TAMANHO = 100;
export const N = 201;
export const CELULA = TAMANHO / (N - 1); // 0,5 m
const AREA = CELULA * CELULA;
const FUNDO_MAXIMO = 3.5; // não deixa cavar mais fundo que isso abaixo do terreno original
const DECLIVE_SOLTO = 0.32; // diferença máxima entre vizinhos para a terra solta (ângulo de repouso ~33°)

const VERDE = new THREE.Color("#5f8f3a");
const VERDE_ESCURO = new THREE.Color("#4a7a2e");
const TERRA = new THREE.Color("#7a5532");
const TERRA_FUNDA = new THREE.Color("#5a3b22");
const TERRA_SOLTA = new THREE.Color("#8d6640");

function ruido(x: number, z: number): number {
  return (
    Math.sin(x * 0.071 + 1.3) * Math.cos(z * 0.053) * 0.9 +
    Math.sin(x * 0.17 + z * 0.13) * 0.35 +
    Math.cos(x * 0.31 - z * 0.27) * 0.12
  );
}

export class Terreno {
  readonly alturas = new Float32Array(N * N);
  readonly original = new Float32Array(N * N);
  readonly malha: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly cores: Float32Array;
  private readonly tom = new Float32Array(N * N); // variação do verde
  // região alterada desde a última atualização da malha
  private iMin = N;
  private iMax = -1;
  private jMin = N;
  private jMax = -1;
  private tempoNormais = 0;
  private normaisPendentes = false;

  constructor() {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = this.xDe(j);
        const z = this.zDe(i);
        const r = Math.hypot(x, z - 4);
        // a obra (centro) é plana; morros suaves em volta e uma borda mais alta fechando o mapa
        const plano = THREE.MathUtils.smoothstep(r, 18, 34);
        const borda = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - 40);
        const h = ruido(x, z) * 1.6 * plano + borda * borda * 0.12;
        const k = i * N + j;
        this.alturas[k] = h;
        this.original[k] = h;
        this.tom[k] = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.cos(z * 0.7) * 2) * Math.cos(z * 1.1);
      }
    }

    this.geo = new THREE.PlaneGeometry(TAMANHO, TAMANHO, N - 1, N - 1);
    this.geo.rotateX(-Math.PI / 2); // a linha 0 do plano fica em z = -TAMANHO/2
    this.cores = new Float32Array(N * N * 3);
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.cores, 3));
    const pos = this.geo.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < N * N; k++) {
      pos.setY(k, this.alturas[k]);
      this.pintar(k);
    }
    this.geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.malha = new THREE.Mesh(this.geo, mat);
    this.malha.receiveShadow = true;
  }

  xDe(j: number): number {
    return -TAMANHO / 2 + j * CELULA;
  }

  zDe(i: number): number {
    return -TAMANHO / 2 + i * CELULA;
  }

  // altura no ponto (x, z), interpolada entre os 4 vértices da célula
  altura(x: number, z: number): number {
    const fj = THREE.MathUtils.clamp((x + TAMANHO / 2) / CELULA, 0, N - 1.001);
    const fi = THREE.MathUtils.clamp((z + TAMANHO / 2) / CELULA, 0, N - 1.001);
    const j = Math.floor(fj);
    const i = Math.floor(fi);
    const tx = fj - j;
    const tz = fi - i;
    const a = this.alturas[i * N + j];
    const b = this.alturas[i * N + j + 1];
    const c = this.alturas[(i + 1) * N + j];
    const d = this.alturas[(i + 1) * N + j + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  // Tira terra em volta de (cx, cz) até a altura `fundo` (com as bordas em rampa).
  // Devolve o volume tirado (m³), no máximo `volumeMaximo`.
  cavar(cx: number, cz: number, fundo: number, raio: number, volumeMaximo: number): number {
    if (volumeMaximo <= 0) return 0;
    const [i0, i1, j0, j1] = this.faixa(cx, cz, raio);
    const quedas: [number, number][] = [];
    let total = 0;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const d = Math.hypot(this.xDe(j) - cx, this.zDe(i) - cz);
        if (d > raio) continue;
        const k = i * N + j;
        const alvo = Math.max(fundo + (d / raio) ** 2 * raio * 0.7, this.original[k] - FUNDO_MAXIMO);
        const queda = this.alturas[k] - alvo;
        if (queda > 0.001) {
          quedas.push([k, queda]);
          total += queda * AREA;
        }
      }
    }
    if (total <= 0) return 0;
    const escala = Math.min(1, volumeMaximo / total);
    for (const [k, queda] of quedas) this.alturas[k] -= queda * escala;
    this.marcar(i0, i1, j0, j1);
    return total * escala;
  }

  // Joga `volume` m³ de terra em volta de (cx, cz) (distribuição gaussiana) e deixa escorrer.
  depositar(cx: number, cz: number, volume: number, raio = 0.7): void {
    const [i0, i1, j0, j1] = this.faixa(cx, cz, raio);
    let soma = 0;
    const pesos: [number, number][] = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const d2 = (this.xDe(j) - cx) ** 2 + (this.zDe(i) - cz) ** 2;
        if (d2 > raio * raio) continue;
        const w = Math.exp((-d2 * 2) / (raio * raio));
        pesos.push([i * N + j, w]);
        soma += w;
      }
    }
    if (soma <= 0) return;
    for (const [k, w] of pesos) this.alturas[k] += (volume * w) / (soma * AREA);
    this.escorrer(cx, cz, raio + 1.5, 6);
  }

  // A terra solta (acima do terreno original) escorre para os vizinhos mais baixos até o ângulo de repouso.
  // As paredes cavadas no terreno firme ficam de pé.
  private escorrer(cx: number, cz: number, raio: number, passos: number): void {
    const [i0, i1, j0, j1] = this.faixa(cx, cz, raio);
    const viz = [1, -1, N, -N];
    for (let p = 0; p < passos; p++) {
      for (let i = Math.max(1, i0); i <= Math.min(N - 2, i1); i++) {
        for (let j = Math.max(1, j0); j <= Math.min(N - 2, j1); j++) {
          const k = i * N + j;
          for (const v of viz) {
            const n = k + v;
            const dif = this.alturas[k] - this.alturas[n];
            if (dif <= DECLIVE_SOLTO) continue;
            const solto = this.alturas[k] - Math.min(this.original[k], this.alturas[k]);
            const mover = Math.min((dif - DECLIVE_SOLTO) * 0.5, solto);
            if (mover <= 0) continue;
            this.alturas[k] -= mover;
            this.alturas[n] += mover;
          }
        }
      }
    }
    this.marcar(i0, i1, j0, j1);
  }

  // fração (0 a 1) da vala cavada até `profundidade` no retângulo dado
  progressoVala(x0: number, x1: number, z0: number, z1: number, profundidade: number): number {
    let soma = 0;
    let n = 0;
    for (let i = 0; i < N; i++) {
      const z = this.zDe(i);
      if (z < z0 || z > z1) continue;
      for (let j = 0; j < N; j++) {
        const x = this.xDe(j);
        if (x < x0 || x > x1) continue;
        const k = i * N + j;
        soma += THREE.MathUtils.clamp((this.original[k] - this.alturas[k]) / profundidade, 0, 1);
        n++;
      }
    }
    return n ? soma / n : 0;
  }

  // leva as alterações para a malha (posições e cores já; normais no máximo 8 vezes por segundo)
  atualizar(dt: number): void {
    this.tempoNormais -= dt;
    if (this.iMax >= 0) {
      const pos = this.geo.attributes.position as THREE.BufferAttribute;
      for (let i = this.iMin; i <= this.iMax; i++) {
        for (let j = this.jMin; j <= this.jMax; j++) {
          const k = i * N + j;
          pos.setY(k, this.alturas[k]);
          this.pintar(k);
        }
      }
      pos.needsUpdate = true;
      (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      this.iMin = this.jMin = N;
      this.iMax = this.jMax = -1;
      this.normaisPendentes = true;
    }
    if (this.normaisPendentes && this.tempoNormais <= 0) {
      this.geo.computeVertexNormals();
      this.geo.computeBoundingSphere();
      this.normaisPendentes = false;
      this.tempoNormais = 0.12;
    }
  }

  private pintar(k: number): void {
    const dif = this.alturas[k] - this.original[k];
    const c = new THREE.Color().lerpColors(VERDE, VERDE_ESCURO, this.tom[k]);
    if (dif < -0.04) c.lerpColors(TERRA, TERRA_FUNDA, THREE.MathUtils.clamp(-dif / 2, 0, 1));
    else if (dif > 0.03) c.copy(TERRA_SOLTA).lerp(TERRA, this.tom[k] * 0.4);
    else if (dif < -0.01 || dif > 0.01) c.lerp(TERRA, 0.6);
    this.cores[k * 3] = c.r;
    this.cores[k * 3 + 1] = c.g;
    this.cores[k * 3 + 2] = c.b;
  }

  private faixa(cx: number, cz: number, raio: number): [number, number, number, number] {
    const j0 = Math.max(0, Math.floor((cx - raio + TAMANHO / 2) / CELULA));
    const j1 = Math.min(N - 1, Math.ceil((cx + raio + TAMANHO / 2) / CELULA));
    const i0 = Math.max(0, Math.floor((cz - raio + TAMANHO / 2) / CELULA));
    const i1 = Math.min(N - 1, Math.ceil((cz + raio + TAMANHO / 2) / CELULA));
    return [i0, i1, j0, j1];
  }

  private marcar(i0: number, i1: number, j0: number, j1: number): void {
    this.iMin = Math.min(this.iMin, i0);
    this.iMax = Math.max(this.iMax, i1);
    this.jMin = Math.min(this.jMin, j0);
    this.jMax = Math.max(this.jMax, j1);
  }
}
