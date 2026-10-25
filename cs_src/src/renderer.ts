// renderer.ts
// Cena 3D (Three.js): arena, jogadores remotos, arma na tela e rastros de tiro.

import * as THREE from "three";
import { ALTURA, CAIXAS, OLHO } from "./shared";
import type { GranadaSnap, PlayerInfo, PlayerSnap, Vec3 } from "./types";
import { desligarVAO, suporteWebGL } from "./webgl";

interface Remoto {
  grupo: THREE.Group;
  armas: THREE.Group[];
  alvo: THREE.Vector3;
  alvoYaw: number;
  inicializado: boolean;
}

interface Rastro {
  linha: THREE.Line;
  vida: number;
}

interface GranadaVista {
  mesh: THREE.Mesh;
  alvo: THREE.Vector3;
}

interface Explosao {
  mesh: THREE.Mesh;
  vida: number;
}

const TEMPO_EXPLOSAO = 0.5;
// posição z da ponta do cano de cada arma (para o clarão do tiro)
const PONTAS = [-0.58, -0.24];

// modelos [rifle, pistola, granada], com a origem na mão e a arma apontando para -z
function modelosArmas(): THREE.Group[] {
  const metal = material({ color: 0x20262e, roughness: 0.5, metalness: 0.4 });
  const escuro = material({ color: 0x10141a, metalness: 0.6 });

  const deitar = <T extends THREE.Object3D>(o: T): T => { o.rotation.x = Math.PI / 2; return o; };

  const rifle = new THREE.Group();
  const rCorpo = deitar(new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.34, 6, 16), metal));
  const rCano = deitar(new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.3, 16), escuro));
  rCano.position.set(0, 0.015, -0.4);
  const rCabo = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.1, 4, 12), metal);
  rCabo.position.set(0, -0.08, 0.1);
  rCabo.rotation.x = -0.35;
  rifle.add(rCorpo, rCano, rCabo);

  const pistola = new THREE.Group();
  const pCorpo = deitar(new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 6, 16), metal));
  pCorpo.position.set(0, 0, -0.08);
  const pCano = deitar(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 16), escuro));
  pCano.position.set(0, 0.005, -0.2);
  const pCabo = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.08, 4, 12), metal);
  pCabo.position.set(0, -0.08, -0.01);
  pCabo.rotation.x = -0.25;
  pistola.add(pCorpo, pCano, pCabo);

  const granada = new THREE.Group();
  const gCorpo = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 16, 16),
    material({ color: 0x3a5a3a, roughness: 0.6 }),
  );
  const gTopo = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 12), escuro);
  gTopo.position.y = 0.075;
  const gAlavanca = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 8, 16), escuro);
  gAlavanca.position.set(0.03, 0.09, 0);
  granada.add(gCorpo, gTopo, gAlavanca);
  granada.position.z = -0.1;
  const envolta = new THREE.Group();
  envolta.add(granada);

  return [rifle, pistola, envolta];
}

function texturaChao(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#141c28";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#1f2b3d";
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(21, 21);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Material com iluminação. Com WebGL 2 usa o material realista; em placa antiga (só WebGL 1) ele sai preto,
// então usa o material de iluminação simples (Lambert), que essas placas calculam.
interface OpcoesMaterial {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture;
  roughness?: number;
  metalness?: number;
}

function material(op: OpcoesMaterial): THREE.Material {
  if (suporteWebGL().v2) return new THREE.MeshStandardMaterial(op);
  const p: THREE.MeshLambertMaterialParameters = {};
  if (op.color !== undefined) p.color = op.color;
  if (op.map) p.map = op.map;
  return new THREE.MeshLambertMaterial(p);
}

function etiqueta(nome: string, cor: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 30px ui-monospace, Consolas, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 6;
  g.strokeStyle = "rgba(0,0,0,0.8)";
  g.strokeText(nome, 128, 32);
  g.fillStyle = cor;
  g.fillText(nome, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

function angulo(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// modelo de jogador (cápsula colorida, cabeça, arma na mão e nome); usado no jogo e no lobby
function criarPersonagem(nome: string, corHex: string): { grupo: THREE.Group; armas: THREE.Group[] } {
  const grupo = new THREE.Group();
  const mat = material({ color: new THREE.Color(corHex), roughness: 0.6 });
  const corpo = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.0, 4, 10), mat);
  corpo.position.y = 0.8;
  const cabeca = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 12),
    material({ color: 0xf2d2b0, roughness: 0.8 }),
  );
  cabeca.position.y = ALTURA - 0.2;
  const armas = modelosArmas();
  for (const a of armas) a.position.set(0.28, 1.15, -0.2);
  const tag = etiqueta(nome, corHex);
  tag.position.y = ALTURA + 0.55;
  grupo.add(corpo, cabeca, ...armas, tag);
  return { grupo, armas };
}

// posições (x, z) de cada vaga do grupo no palco do lobby: você no centro, amigos ao redor
const POSICOES_LOBBY: [number, number][] = [[0, 0.3], [-1.5, -0.3], [1.5, -0.3], [0, -1.9]];

export interface MembroLobby {
  nome: string;
  cor: string;
  pronto: boolean;
}

export class Renderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cenaLobby = new THREE.Scene();
  private cameraLobby = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
  private lobbyAtivo = false;
  private lobbyVagas: THREE.Group[] = [];       // uma por membro, posicionadas no palco
  private lobbyPersonagens: THREE.Group[] = []; // o personagem em si (gira/balança dentro da vaga)
  private lobbyTempo = 0;
  private lobbyFracCentro = 0.4; // fração da largura da tela livre (sem o painel de informações)
  private lobbyDesloc = 0;          // quanto o painel empurra o palco para o lado (fração da largura da tela)
  private lobbyPalco = new THREE.Group(); // plataforma e personagens: movem juntos
  private qualidade: "baixa" | "media" | "alta" = window.matchMedia("(hover: none) and (pointer: coarse)").matches ? "media" : "alta";
  private camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 200);
  private remotos = new Map<number, Remoto>();
  private rastros: Rastro[] = [];
  private arma: THREE.Group;
  private armasVista: THREE.Group[];
  private clarao: THREE.Mesh;
  private granadas = new Map<number, GranadaVista>();
  private explosoes: Explosao[] = [];
  private tempoClarao = 0;
  private coice = 0;

  constructor(canvas: HTMLCanvasElement, private wrap: HTMLElement) {
    // placas antigas só têm WebGL 1: usa o modo de compatibilidade em vez de falhar ao abrir
    if (!suporteWebGL().v2) desligarVAO();
    // (sem suavização de bordas nesse modo: ela pesa muito nessas placas e em algumas gera imagem errada)
    this.renderer = suporteWebGL().v2
      ? new THREE.WebGLRenderer({ canvas, antialias: true })
      : new THREE.WebGL1Renderer({ canvas, antialias: false });
    this.aplicarRazaoPixel();

    this.scene.background = new THREE.Color(0x0a0e14);
    this.scene.fog = new THREE.Fog(0x0a0e14, 20, 70);

    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x1a2230, 1.6));
    const sol = new THREE.DirectionalLight(0xffffff, 1.4);
    sol.position.set(10, 20, 6);
    this.scene.add(sol);

    const chao = new THREE.Mesh(
      new THREE.PlaneGeometry(42, 42),
      material({ map: texturaChao(), roughness: 1 }),
    );
    chao.rotation.x = -Math.PI / 2;
    this.scene.add(chao);

    for (const c of CAIXAS) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(c.w, c.h, c.d),
        material({ color: c.cor, roughness: 0.85 }),
      );
      m.position.set(c.x, c.h / 2, c.z);
      this.scene.add(m);
    }

    // arma na câmera
    this.arma = new THREE.Group();
    this.armasVista = modelosArmas();
    this.clarao = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }),
    );
    this.clarao.visible = false;
    this.arma.add(...this.armasVista, this.clarao);
    this.arma.position.set(0.22, -0.2, -0.45);
    this.definirArma(0);
    this.camera.add(this.arma);
    this.scene.add(this.camera);

    this.montarLobby();

    new ResizeObserver(() => this.redimensionar()).observe(wrap);
    this.redimensionar();
  }

  // resolução da renderização: telas densas pesam na bateria/GPU, então a qualidade escolhida limita os pixels desenhados
  private aplicarRazaoPixel(): void {
    const dpr = window.devicePixelRatio || 1;
    const razao = this.qualidade === "baixa" ? Math.max(0.5, Math.min(dpr, 1) * 0.75) : this.qualidade === "media" ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(razao);
  }

  definirQualidade(q: "baixa" | "media" | "alta"): void {
    this.qualidade = q;
    this.redimensionar();
  }

  private redimensionar(): void {
    this.aplicarRazaoPixel();
    const w = Math.max(1, this.wrap.clientWidth);
    const h = Math.max(1, this.wrap.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.cameraLobby.aspect = w / h;
    this.cameraLobby.updateProjectionMatrix();
    this.ajustarCameraLobby();
  }

  // ---- Lobby: o personagem (e os amigos do grupo) em 3D atrás da interface ----

  private montarLobby(): void {
    const c = this.cenaLobby;
    c.background = new THREE.Color(0x070b11);
    c.fog = new THREE.Fog(0x070b11, 9, 24);
    c.add(new THREE.HemisphereLight(0xbcd0ff, 0x10151f, 1.1));
    const principal = new THREE.DirectionalLight(0xffffff, 2.2);
    principal.position.set(-3, 5, 5);
    const contorno1 = new THREE.DirectionalLight(0x4de2c2, 2.4);
    contorno1.position.set(4, 3, -5);
    const contorno2 = new THREE.DirectionalLight(0xff5d73, 1.4);
    contorno2.position.set(-5, 2, -3);
    c.add(principal, contorno1, contorno2);

    const palco = new THREE.Mesh(
      new THREE.CylinderGeometry(3.6, 3.8, 0.12, 64),
      material({ color: 0x0f1724, roughness: 0.8 }),
    );
    palco.position.y = -0.06;
    const borda = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: 0x4de2c2 }));
    borda.rotation.x = Math.PI / 2;
    this.lobbyPalco.add(palco, borda);
    c.add(this.lobbyPalco);

    this.definirLobby([{ nome: "Você", cor: "#4de2c2", pronto: false }]);
  }

  ativarLobby(ativo: boolean): void {
    this.lobbyAtivo = ativo;
  }

  // reconstrói os personagens do palco (chamar quando o grupo, nomes ou "pronto" mudarem)
  definirLobby(membros: MembroLobby[]): void {
    for (const v of this.lobbyVagas) this.lobbyPalco.remove(v);
    this.lobbyVagas = [];
    this.lobbyPersonagens = [];

    membros.slice(0, POSICOES_LOBBY.length).forEach((m) => {
      const vaga = new THREE.Group();
      const { grupo, armas } = criarPersonagem(m.pronto ? `${m.nome} ✓` : m.nome, m.cor);
      armas.forEach((a, k) => { a.visible = k === 0; });
      const anel = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.7, 40),
        new THREE.MeshBasicMaterial({ color: m.pronto ? 0x4de2c2 : 0x2a3a52, side: THREE.DoubleSide }),
      );
      anel.rotation.x = -Math.PI / 2;
      anel.position.y = 0.01;
      vaga.add(anel, grupo);
      this.lobbyPalco.add(vaga);
      this.lobbyVagas.push(vaga);
      this.lobbyPersonagens.push(grupo);
    });
    this.ajustarCameraLobby();
  }

  // a interface informa quanto da largura está livre para os personagens (os painéis cobrem as laterais)
  definirAreaLobby(fracaoCentro: number, deslocamento = 0): void {
    this.lobbyFracCentro = Math.max(0.15, Math.min(1, fracaoCentro));
    this.lobbyDesloc = Math.max(0, Math.min(0.45, deslocamento));
    this.ajustarCameraLobby();
  }

  // enquadra todos os personagens, inclusive em telas estreitas (celular em pé)
  private ajustarCameraLobby(): void {
    const aspecto = this.cameraLobby.aspect;
    const meia = Math.tan(THREE.MathUtils.degToRad(this.cameraLobby.fov / 2));
    let abertura = 0.8;
    if (aspecto >= 1) {
      // deitado: aproxima os amigos para que caibam entre os painéis laterais
      const largVisivel = 2 * 6.4 * meia * aspecto;
      const metadeLivre = (this.lobbyFracCentro * largVisivel) / 2;
      abertura = Math.max(0.35, Math.min(1, (metadeLivre - 0.55) / 1.5));
    }
    let maiorX = 0;
    this.lobbyVagas.forEach((vaga, i) => {
      const [x, z] = POSICOES_LOBBY[i];
      vaga.position.set(x * abertura, 0, z);
      maiorX = Math.max(maiorX, Math.abs(x * abertura));
    });
    const largura = maiorX * 2 + 2.4;
    const meiaAltura = meia;
    const distancia = Math.max(6.4, largura / (2 * meiaAltura * aspecto));
    // em pé, a interface ocupa a parte de baixo: sobe os personagens para o terço superior da tela
    const alturaVisivel = 2 * distancia * meiaAltura;
    const desloc = aspecto < 1 ? 0.16 * alturaVisivel : 0;
    // o painel de informações ocupa a direita: centraliza os personagens na área que sobra à esquerda
    this.lobbyPalco.position.x = -this.lobbyDesloc * alturaVisivel * aspecto;
    this.cameraLobby.position.set(0, 1.45 - desloc, distancia);
    this.cameraLobby.lookAt(0, 0.95 - desloc, 0);
  }

  private desenharLobby(dt: number): void {
    this.lobbyTempo += dt;
    this.lobbyPersonagens.forEach((p, i) => {
      // de frente para a câmera, com um balanço leve de "descanso"
      p.rotation.y = Math.PI + Math.sin(this.lobbyTempo * 0.7 + i * 1.3) * 0.4;
      p.position.y = Math.sin(this.lobbyTempo * 1.6 + i) * 0.015;
    });
    this.renderer.render(this.cenaLobby, this.cameraLobby);
  }

  definirJogadores(infos: PlayerInfo[], eu: number): void {
    for (const r of this.remotos.values()) this.scene.remove(r.grupo);
    this.remotos.clear();

    for (const info of infos) {
      if (info.id === eu) continue;
      const { grupo, armas } = criarPersonagem(info.nome, info.cor);
      grupo.visible = false;
      this.scene.add(grupo);
      this.remotos.set(info.id, { grupo, armas, alvo: new THREE.Vector3(), alvoYaw: 0, inicializado: false });
    }
  }

  atualizarRemoto(p: PlayerSnap): void {
    const r = this.remotos.get(p.id);
    if (!r) return;
    r.alvo.set(p.x, p.y, p.z);
    r.alvoYaw = p.yaw;
    r.grupo.visible = p.alive && p.on;
    r.armas.forEach((a, i) => { a.visible = i === p.arma; });
    if (!r.inicializado) {
      r.grupo.position.copy(r.alvo);
      r.grupo.rotation.y = p.yaw;
      r.inicializado = true;
    }
  }

  resetarRemotos(): void {
    for (const r of this.remotos.values()) r.inicializado = false;
  }

  posicionarCamera(x: number, y: number, z: number, yaw: number, pitch: number, vivo: boolean): void {
    this.camera.position.set(x, y + (vivo ? OLHO : 0.4), z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(vivo ? pitch : -0.2, yaw, vivo ? 0 : 0.6);
    this.arma.visible = vivo;
  }

  adicionarRastro(o: Vec3, e: Vec3): void {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(o[0], o[1] - 0.15, o[2]),
      new THREE.Vector3(e[0], e[1], e[2]),
    ]);
    const linha = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true }));
    this.scene.add(linha);
    this.rastros.push({ linha, vida: 0.08 });
  }

  definirArma(w: number): void {
    this.armasVista.forEach((a, i) => { a.visible = i === w; });
    this.clarao.position.set(0, 0.015, PONTAS[w] ?? 0);
    this.clarao.visible = false;
  }

  atualizarGranadas(lista: GranadaSnap[]): void {
    const ativos = new Set<number>();
    for (const g of lista) {
      ativos.add(g.id);
      let v = this.granadas.get(g.id);
      if (!v) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 12, 12),
          material({ color: 0x3a5a3a, roughness: 0.6 }),
        );
        mesh.position.set(g.x, g.y, g.z);
        this.scene.add(mesh);
        v = { mesh, alvo: new THREE.Vector3() };
        this.granadas.set(g.id, v);
      }
      v.alvo.set(g.x, g.y, g.z);
    }
    for (const [id, v] of this.granadas) {
      if (ativos.has(id)) continue;
      this.scene.remove(v.mesh);
      v.mesh.geometry.dispose();
      (v.mesh.material as THREE.Material).dispose();
      this.granadas.delete(id);
    }
  }

  explosao(x: number, y: number, z: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.9 }),
    );
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.explosoes.push({ mesh, vida: TEMPO_EXPLOSAO });
  }

  disparoLocal(w: number): void {
    if (w === 2) return;
    this.mostrarClarao();
    this.coice = w === 1 ? 1.6 : 1;
  }

  private mostrarClarao(): void {
    this.clarao.visible = true;
    this.tempoClarao = 0.04;
  }

  desenhar(dt: number): void {
    if (this.lobbyAtivo) { this.desenharLobby(dt); return; }

    const k = 1 - Math.exp(-dt * 18);
    for (const r of this.remotos.values()) {
      r.grupo.position.lerp(r.alvo, k);
      r.grupo.rotation.y = angulo(r.grupo.rotation.y, r.alvoYaw, k);
    }

    for (const v of this.granadas.values()) v.mesh.position.lerp(v.alvo, k);

    for (let i = this.explosoes.length - 1; i >= 0; i--) {
      const e = this.explosoes[i];
      e.vida -= dt;
      if (e.vida <= 0) {
        this.scene.remove(e.mesh);
        e.mesh.geometry.dispose();
        (e.mesh.material as THREE.Material).dispose();
        this.explosoes.splice(i, 1);
      } else {
        const f = 1 - e.vida / TEMPO_EXPLOSAO;
        e.mesh.scale.setScalar(0.5 + f * 4.5);
        (e.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - f);
      }
    }

    for (let i = this.rastros.length - 1; i >= 0; i--) {
      const r = this.rastros[i];
      r.vida -= dt;
      if (r.vida <= 0) {
        this.scene.remove(r.linha);
        r.linha.geometry.dispose();
        (r.linha.material as THREE.Material).dispose();
        this.rastros.splice(i, 1);
      } else {
        (r.linha.material as THREE.LineBasicMaterial).opacity = r.vida / 0.08;
      }
    }

    if (this.tempoClarao > 0) {
      this.tempoClarao -= dt;
      if (this.tempoClarao <= 0) this.clarao.visible = false;
    }
    this.coice = Math.max(0, this.coice - dt * 12);
    this.arma.position.z = -0.45 + this.coice * 0.06;
    this.arma.rotation.x = this.coice * 0.05;

    this.renderer.render(this.scene, this.camera);
  }
}
