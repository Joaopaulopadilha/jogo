import * as THREE from "three";
import { Terreno } from "./terreno";
import { Caminhao } from "./caminhao";
import { construirFavela, Favela } from "./favela";
import { Bloco, circulo } from "./colisao";

function caixa(w: number, h: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// vala da missão: retângulo marcado por estacas
export const VALA = { x0: -0.8, x1: 0.8, z0: -1, z1: 5, profundidade: 1 };

export function montarCenario(cena: THREE.Scene, terreno: Terreno): { sol: THREE.DirectionalLight; caminhao: Caminhao; arvores: Bloco[]; favela: Favela } {
  const arvores: Bloco[] = [];
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
    } while (Math.hypot(x, z - 4) < 24 || (x < -14 && z > 14)); // sem árvores na obra nem no morro da comunidade
    const esc = 0.75 + aleat() * 0.6;
    const y = terreno.altura(x, z);
    m.compose(new THREE.Vector3(x, y + 1.1 * esc, z), new THREE.Quaternion(), new THREE.Vector3(esc, esc, esc));
    tronco.setMatrixAt(n, m);
    arvores.push(circulo(x, z, 0.3 * esc, y - 1, y + 2.2 * esc));
    m.compose(new THREE.Vector3(x, y + (2.2 + 1.8) * esc, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), aleat() * 6), new THREE.Vector3(esc, esc, esc));
    copa.setMatrixAt(n, m);
  }
  tronco.castShadow = copa.castShadow = true;
  cena.add(tronco, copa);

  const caminhao = new Caminhao(4.9, terreno.altura(4.9, 7.6), 7.6, 0);
  cena.add(caminhao.grupo);
  const favela = construirFavela(cena, terreno);
  return { sol, caminhao, arvores, favela };
}
