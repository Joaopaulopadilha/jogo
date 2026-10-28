import * as THREE from "three";
import { Terreno } from "./terreno";
import { materialTerra } from "./maquina";

function caixa(w: number, h: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// vala da missão: retângulo marcado por estacas
export const VALA = { x0: -0.8, x1: 0.8, z0: -1, z1: 5, profundidade: 1 };

// Caminhão basculante parado ao lado da obra; a terra que cai na caçamba é contada.
export class Caminhao {
  readonly grupo = new THREE.Group();
  volume = 0;
  readonly cacamba = { x: 1.1, z0: -2.7, z1: 0.8, piso: 1.4, borda: 2.2 };
  private readonly terra: THREE.Mesh;
  private readonly local = new THREE.Vector3();

  constructor(terreno: Terreno, x: number, z: number, rumo: number) {
    const g = this.grupo;
    const vermelho = new THREE.MeshStandardMaterial({ color: "#c0392b", roughness: 0.45, metalness: 0.2 });
    const laranja = new THREE.MeshStandardMaterial({ color: "#e67e22", roughness: 0.6, metalness: 0.2 });
    const aco = new THREE.MeshStandardMaterial({ color: "#2b2d30", roughness: 0.6, metalness: 0.5 });
    const pneu = new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.95 });
    const vidro = new THREE.MeshStandardMaterial({ color: "#2b3f4f", roughness: 0.1, metalness: 0.6 });
    const c = this.cacamba;

    g.add(caixa(1.6, 0.35, 6.2, aco, 0, 0.95, -0.4)); // chassi
    // cabine
    g.add(caixa(2.3, 1.5, 1.7, vermelho, 0, 1.95, 1.85));
    g.add(caixa(2.32, 0.7, 1.0, vidro, 0, 2.3, 2.2));
    g.add(caixa(2.4, 0.4, 0.3, aco, 0, 1.0, 2.75)); // para-choque
    // caçamba aberta
    const comp = c.z1 - c.z0;
    const meio = (c.z0 + c.z1) / 2;
    const alt = c.borda - c.piso;
    g.add(caixa(c.x * 2 + 0.2, 0.12, comp + 0.2, laranja, 0, c.piso - 0.06, meio));
    g.add(caixa(0.1, alt, comp + 0.2, laranja, c.x + 0.05, c.piso + alt / 2, meio));
    g.add(caixa(0.1, alt, comp + 0.2, laranja, -c.x - 0.05, c.piso + alt / 2, meio));
    g.add(caixa(c.x * 2 + 0.2, alt + 0.4, 0.1, laranja, 0, c.piso + alt / 2 + 0.2, c.z1 + 0.05));
    g.add(caixa(c.x * 2 + 0.2, alt, 0.1, laranja, 0, c.piso + alt / 2, c.z0 - 0.05));
    for (let n = 0; n < 4; n++) g.add(caixa(0.06, alt, 0.08, aco, c.x + 0.12, c.piso + alt / 2, c.z0 + 0.3 + n * 0.95));
    for (let n = 0; n < 4; n++) g.add(caixa(0.06, alt, 0.08, aco, -c.x - 0.12, c.piso + alt / 2, c.z0 + 0.3 + n * 0.95));
    // rodas (3 eixos)
    for (const zr of [1.7, -1.3, -2.5]) {
      for (const lado of [-1, 1]) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 22), pneu);
        r.rotation.z = Math.PI / 2;
        r.position.set(lado * 1.0, 0.55, zr);
        r.castShadow = true;
        g.add(r);
      }
    }
    this.terra = new THREE.Mesh(new THREE.BoxGeometry(c.x * 2 - 0.05, 1, comp - 0.05), materialTerra);
    this.terra.position.set(0, c.piso, meio);
    this.terra.visible = false;
    this.terra.castShadow = true;
    g.add(this.terra);

    g.position.set(x, terreno.altura(x, z), z);
    g.rotation.y = rumo;
    g.updateMatrixWorld(true);
  }

  private alturaTerra(): number {
    const c = this.cacamba;
    return Math.min(this.volume / (c.x * 2 * (c.z1 - c.z0)), c.borda - c.piso + 0.4);
  }

  // a partícula caiu dentro da caçamba? (então fica aqui e é contada)
  pegar(p: THREE.Vector3, volume: number): boolean {
    const c = this.cacamba;
    this.grupo.worldToLocal(this.local.copy(p));
    const l = this.local;
    if (Math.abs(l.x) > c.x || l.z < c.z0 || l.z > c.z1) return false;
    if (l.y > c.piso + this.alturaTerra() + 0.05 || l.y < c.piso - 0.4) return false;
    this.volume += volume;
    const h = this.alturaTerra();
    this.terra.visible = h > 0.01;
    this.terra.scale.y = Math.max(h, 0.01);
    this.terra.position.y = c.piso + h / 2;
    return true;
  }

  // altura da superfície da caçamba (piso ou terra) no ponto, ou null se o ponto não está sobre ela
  superficie(x: number, z: number): number | null {
    const c = this.cacamba;
    const l = this.grupo.worldToLocal(this.local.set(x, this.grupo.position.y, z));
    if (Math.abs(l.x) > c.x || l.z < c.z0 || l.z > c.z1) return null;
    return this.grupo.position.y + c.piso + this.alturaTerra();
  }

  // a máquina não atravessa o caminhão: devolve o ponto empurrado para fora (ou null se não encostou)
  empurrar(x: number, z: number, folga: number): THREE.Vector3 | null {
    const l = this.grupo.worldToLocal(this.local.set(x, this.grupo.position.y, z));
    const mx = 1.25 + folga;
    const z0 = -3.6 - folga;
    const z1 = 2.9 + folga;
    if (Math.abs(l.x) >= mx || l.z <= z0 || l.z >= z1) return null;
    const dx = mx - Math.abs(l.x);
    const dz = Math.min(l.z - z0, z1 - l.z);
    if (dx < dz) l.x = Math.sign(l.x || 1) * mx;
    else l.z = l.z - z0 < z1 - l.z ? z0 : z1;
    return this.grupo.localToWorld(l);
  }
}

export function montarCenario(cena: THREE.Scene, terreno: Terreno): { sol: THREE.DirectionalLight; caminhao: Caminhao } {
  cena.background = new THREE.Color("#a9cfe8");
  cena.fog = new THREE.Fog("#a9cfe8", 60, 140);
  cena.add(new THREE.HemisphereLight("#dff0ff", "#5b4a33", 0.9));
  const sol = new THREE.DirectionalLight("#fff4e0", 2.2);
  sol.castShadow = true;
  const toque = matchMedia("(pointer: coarse)").matches;
  sol.shadow.mapSize.set(toque ? 1024 : 2048, toque ? 1024 : 2048); // celular: sombra mais leve
  const s = sol.shadow.camera;
  s.left = -22;
  s.right = 22;
  s.top = 22;
  s.bottom = -22;
  s.near = 1;
  s.far = 90;
  sol.shadow.bias = -0.0004;
  sol.shadow.normalBias = 0.03;
  cena.add(sol, sol.target);

  cena.add(terreno.malha);

  // estacas com fita marcando a vala
  const madeira = new THREE.MeshStandardMaterial({ color: "#c9a26b", roughness: 0.9 });
  const fita = new THREE.MeshStandardMaterial({ color: "#ff6a00", emissive: "#5a2000", roughness: 0.6 });
  const cantos: [number, number][] = [
    [VALA.x0 - 0.3, VALA.z0 - 0.3], [VALA.x1 + 0.3, VALA.z0 - 0.3],
    [VALA.x1 + 0.3, VALA.z1 + 0.3], [VALA.x0 - 0.3, VALA.z1 + 0.3],
  ];
  for (const [x, z] of cantos) {
    const e = caixa(0.08, 1.0, 0.08, madeira, x, terreno.altura(x, z) + 0.5, z);
    cena.add(e);
  }
  for (let n = 0; n < 4; n++) {
    const [ax, az] = cantos[n];
    const [bx, bz] = cantos[(n + 1) % 4];
    const len = Math.hypot(bx - ax, bz - az);
    const f = caixa(0.02, 0.06, len, fita, (ax + bx) / 2, terreno.altura(ax, az) + 0.85, (az + bz) / 2);
    f.rotation.y = Math.atan2(bx - ax, bz - az);
    f.castShadow = false;
    cena.add(f);
  }

  // cones na obra
  const coneMat = new THREE.MeshStandardMaterial({ color: "#ff5a1f", roughness: 0.5 });
  for (const [x, z] of [[-4, -4], [4, -4], [-4, 10], [-7, 3]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 14), coneMat);
    cone.position.set(x, terreno.altura(x, z) + 0.35, z);
    cone.castShadow = true;
    cena.add(cone);
  }

  // árvores fora da obra (instanciadas)
  const nArv = 70;
  const tronco = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.26, 2.2, 8), new THREE.MeshStandardMaterial({ color: "#5a3d24", roughness: 0.9 }), nArv);
  const copa = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 4.2, 9), new THREE.MeshStandardMaterial({ color: "#2f6b2f", roughness: 0.85 }), nArv);
  const m = new THREE.Matrix4();
  let semente = 7;
  const aleat = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < nArv; n++) {
    let x = 0;
    let z = 0;
    do {
      x = (aleat() - 0.5) * 88;
      z = (aleat() - 0.5) * 88;
    } while (Math.hypot(x, z - 4) < 24);
    const esc = 0.75 + aleat() * 0.6;
    const y = terreno.altura(x, z);
    m.compose(new THREE.Vector3(x, y + 1.1 * esc, z), new THREE.Quaternion(), new THREE.Vector3(esc, esc, esc));
    tronco.setMatrixAt(n, m);
    m.compose(new THREE.Vector3(x, y + (2.2 + 1.8) * esc, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aleat() * 6), new THREE.Vector3(esc, esc, esc));
    copa.setMatrixAt(n, m);
  }
  tronco.castShadow = copa.castShadow = true;
  cena.add(tronco, copa);

  const caminhao = new Caminhao(terreno, 4.9, 7.6, 0);
  cena.add(caminhao.grupo);
  return { sol, caminhao };
}
