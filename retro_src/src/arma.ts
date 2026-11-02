import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Fuzil estelar (modelos/fuzil_estelar.py): a origem é a mão que segura, o cano aponta para -Z e a mira ("reddot") é um objeto à parte,
// que some quando o jogador mira (a câmera vai para o lugar dela e a mira vira um ponto vermelho na tela).
export const ARMA = {
  boca: new THREE.Vector3(0, 0.247, -0.663), // ponta do cano (clarão e traço do tiro saem daqui)
  olho: new THREE.Vector3(0, 0.38, 0.03), // um palmo atrás do reddot: onde a câmera fica ao mirar
};

let modelo: Promise<THREE.Group> | null = null;

// cada operário recebe uma cópia (a malha e os materiais são compartilhados)
export function criarArma(): Promise<THREE.Group> {
  if (!modelo) {
    modelo = new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}modelos/fuzil_estelar.glb`).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.frustumCulled = false;
        }
      });
      return g.scene;
    });
  }
  return modelo.then((m) => m.clone(true));
}
