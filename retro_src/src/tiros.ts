import * as THREE from "three";

// Efeitos dos tiros do fuzil: traço luminoso da boca até o ponto atingido, clarão na boca e poeira/faíscas no impacto.
// Tudo em peças reaproveitadas (sem criar objetos a cada tiro).

type Impacto = "terra" | "objeto" | "jogador" | "ar";

function textura(cor: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, cor);
  grad.addColorStop(0.35, cor.replace("1)", "0.55)"));
  grad.addColorStop(1, cor.replace("1)", "0)"));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Vida {
  obj: THREE.Object3D;
  t: number;
  dur: number;
}

export class Tiros {
  readonly grupo = new THREE.Group();
  private readonly traços: THREE.Mesh[] = [];
  private readonly sprites: THREE.Sprite[] = [];
  private readonly vivos: (Vida & { tipo: "traço" | "clarao" | "impacto"; tam: number; v?: THREE.Vector3 })[] = [];
  private readonly texClarao = textura("rgba(255,214,120,1)");
  private readonly texPoeira = textura("rgba(160,140,110,1)");
  private readonly texFaisca = textura("rgba(255,230,160,1)");
  private readonly texSangue = textura("rgba(255,255,255,1)");
  private readonly eixoZ = new THREE.Vector3(0, 0, 1);

  constructor(cena: THREE.Scene) {
    cena.add(this.grupo);
    this.grupo.frustumCulled = false;
  }

  private traço(): THREE.Mesh {
    let m = this.traços.pop();
    if (!m) {
      m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.frustumCulled = false;
    }
    this.grupo.add(m);
    return m;
  }

  private sprite(tex: THREE.Texture): THREE.Sprite {
    let s = this.sprites.pop();
    if (!s) s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
    (s.material as THREE.SpriteMaterial).map = tex;
    this.grupo.add(s);
    return s;
  }

  // um tiro: do cano (boca) até o ponto atingido
  tiro(boca: THREE.Vector3, alvo: THREE.Vector3, tipo: Impacto): void {
    const d = alvo.clone().sub(boca);
    const comp = d.length();
    if (comp > 0.2) {
      const m = this.traço();
      m.position.copy(boca).addScaledVector(d, 0.5);
      m.quaternion.setFromUnitVectors(this.eixoZ, d.clone().normalize());
      m.scale.set(0.025, 0.025, comp);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.9;
      this.vivos.push({ obj: m, t: 0, dur: 0.07, tipo: "traço", tam: 1 });
    }
    const f = this.sprite(this.texClarao);
    f.position.copy(boca);
    f.scale.setScalar(0.55);
    (f.material as THREE.SpriteMaterial).opacity = 1;
    f.material.blending = THREE.AdditiveBlending;
    this.vivos.push({ obj: f, t: 0, dur: 0.06, tipo: "clarao", tam: 0.55 });
    if (tipo === "ar") return;
    const p = this.sprite(tipo === "terra" ? this.texPoeira : tipo === "jogador" ? this.texSangue : this.texFaisca);
    p.position.copy(alvo);
    p.material.blending = tipo === "objeto" ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.scale.setScalar(0.2);
    (p.material as THREE.SpriteMaterial).opacity = 0.9;
    this.vivos.push({ obj: p, t: 0, dur: tipo === "terra" ? 0.45 : 0.25, tipo: "impacto", tam: tipo === "terra" ? 0.9 : 0.5, v: new THREE.Vector3(0, tipo === "terra" ? 0.8 : 0.2, 0) });
  }

  atualizar(dt: number): void {
    for (let i = this.vivos.length - 1; i >= 0; i--) {
      const v = this.vivos[i];
      v.t += dt;
      const k = v.t / v.dur;
      if (k >= 1) {
        this.grupo.remove(v.obj);
        if (v.tipo === "traço") this.traços.push(v.obj as THREE.Mesh);
        else this.sprites.push(v.obj as THREE.Sprite);
        this.vivos.splice(i, 1);
        continue;
      }
      if (v.tipo === "traço") ((v.obj as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      else {
        const s = v.obj as THREE.Sprite;
        (s.material as THREE.SpriteMaterial).opacity = (v.tipo === "clarao" ? 1 : 0.9) * (1 - k);
        s.scale.setScalar(v.tam * (v.tipo === "clarao" ? 1 - 0.5 * k : 0.3 + 0.7 * k));
        if (v.v) s.position.addScaledVector(v.v, dt);
      }
    }
  }
}
