import * as THREE from "three";
import { Operario } from "./operario";

// Os outros jogadores da sala: um operário (com o nome em cima) para cada um, que acompanha os dados que chegam pela rede.

export interface DadosJogador {
  x: number;
  y: number;
  z: number;
  rumo: number;
  anim: string;
  esc: number; // velocidade da animação
  av?: string; // personagem escolhido
  ar?: number; // fuzil: 1 = nas mãos, 2 = mirando
  ap?: number; // para onde o cano aponta (rad, para cima +)
  vi?: number; // vida (0 a 100): com 0 o jogador foi eliminado e some até renascer
  es?: number; // escudo (0 a 50)
}

interface Avatar {
  nome: string;
  av: string;
  op: Operario;
  alvo: DadosJogador;
  rotulo: { desenhar: (vi?: number, es?: number) => void };
  primeiro: boolean; // ainda não recebeu posição: aparece direto no lugar, sem deslizar
}

// nome do jogador (e, na sala, as barras de escudo azul e vida em cima), um sprite que acompanha o avatar
function etiqueta(nome: string): { sprite: THREE.Sprite; desenhar: (vi?: number, es?: number) => void } {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 88;
  const g = c.getContext("2d")!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.55, 1);
  s.position.y = 2.3;
  s.renderOrder = 5;
  let ultimo = "";
  const desenhar = (vi?: number, es?: number): void => {
    const chave = `${vi === undefined ? "-" : Math.round(vi / 4)}|${es === undefined ? "-" : Math.round(es / 2)}`;
    if (chave === ultimo) return;
    ultimo = chave;
    g.clearRect(0, 0, 256, 88);
    g.font = "bold 28px 'Segoe UI', system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const larg = Math.min(248, g.measureText(nome).width + 28);
    g.fillStyle = "rgba(20,22,26,0.78)";
    g.beginPath();
    g.roundRect((256 - larg) / 2, 2, larg, 40, 12);
    g.fill();
    g.fillStyle = "#ffd34d";
    g.fillText(nome, 128, 23, 224);
    if (vi !== undefined) {
      const barra = (y: number, h: number, frac: number, cor: string): void => {
        g.fillStyle = "rgba(20,22,26,0.78)";
        g.fillRect(26, y - 2, 204, h + 4);
        g.fillStyle = cor;
        g.fillRect(28, y, 200 * Math.max(0, Math.min(1, frac)), h);
      };
      barra(50, 9, (es ?? 0) / 50, "#3fa7ff");
      barra(64, 12, vi / 100, vi > 35 ? "#4cd964" : "#ff4b3e");
    }
    tex.needsUpdate = true;
  };
  desenhar();
  return { sprite: s, desenhar };
}

export class Elenco {
  private readonly avatares = new Map<string, Avatar>();

  constructor(private readonly cena: THREE.Scene, private readonly banco: THREE.Object3D, private readonly bancoCam: THREE.Object3D, private readonly urlDe: (av: string) => string) {}

  get nomes(): [string, string][] {
    return [...this.avatares].map(([uid, a]) => [uid, a.nome]);
  }

  atualizar(uid: string, nome: string, dados: DadosJogador): void {
    let a = this.avatares.get(uid);
    if (!a) {
      const op = new Operario();
      const rotulo = etiqueta(nome);
      op.grupo.add(rotulo.sprite);
      this.cena.add(op.grupo);
      const av = dados.av ?? "";
      void op.carregar(this.urlDe(av));
      a = { nome, av, op, alvo: dados, rotulo, primeiro: true };
      this.avatares.set(uid, a);
    }
    a.alvo = dados;
    const av = dados.av ?? a.av;
    if (av !== a.av) {
      a.av = av; // o jogador trocou de personagem
      void a.op.carregar(this.urlDe(av));
    }
  }

  // posição de cada jogador da sala (para os tiros acertarem)
  posicoes(): { uid: string; x: number; y: number; z: number }[] {
    return [...this.avatares].map(([uid, a]) => ({ uid, x: a.op.grupo.position.x, y: a.op.grupo.position.y, z: a.op.grupo.position.z }));
  }

  // o jogador deu um tiro: o fuzil dele dá o coice
  coice(uid: string): void {
    const a = this.avatares.get(uid);
    if (a) a.op.arma.coice = 1;
  }

  // mantém só os jogadores da lista (quem saiu da sala some)
  manter(uids: Set<string>): void {
    for (const uid of [...this.avatares.keys()]) if (!uids.has(uid)) this.remover(uid);
  }

  remover(uid: string): void {
    const a = this.avatares.get(uid);
    if (!a) return;
    a.op.grupo.parent?.remove(a.op.grupo);
    this.avatares.delete(uid);
  }

  limpar(): void {
    for (const uid of [...this.avatares.keys()]) this.remover(uid);
  }

  // condutor / condutorCam = quem está sentado na máquina / no caminhão (acompanha o veículo)
  animar(dt: number, condutor: string, condutorCam: string): void {
    const f = Math.min(1, Math.max(0, 1 - Math.exp(-dt * 12)));
    for (const [uid, a] of this.avatares) {
      const g = a.op.grupo;
      const assento = uid === condutor ? this.banco : uid === condutorCam ? this.bancoCam : null;
      if (assento) {
        if (g.parent !== assento) {
          assento.add(g);
          g.position.set(0, -0.25, 0);
          g.rotation.set(0, 0, 0);
        }
        a.op.tocar("sentado", 0.3);
        a.op.arma.ligada = false;
        a.primeiro = true;
      } else {
        if (g.parent !== this.cena) this.cena.add(g);
        const d = a.alvo;
        if (a.primeiro) {
          g.position.set(d.x, d.y, d.z);
          g.rotation.y = d.rumo;
          a.primeiro = false;
        } else {
          g.position.x += (d.x - g.position.x) * f;
          g.position.y += (d.y - g.position.y) * f;
          g.position.z += (d.z - g.position.z) * f;
          const dif = Math.atan2(Math.sin(d.rumo - g.rotation.y), Math.cos(d.rumo - g.rotation.y));
          g.rotation.y += dif * f;
        }
        a.op.tocar(d.anim || "parado", 0.2, d.esc || 1);
        const ar = d.ar ?? 0;
        g.visible = d.vi === undefined || d.vi > 0; // eliminado: some até renascer
        a.rotulo.desenhar(d.vi, d.es);
        a.op.arma.ligada = (ar & 1) === 1;
        a.op.arma.mirando = (ar & 2) === 2;
        a.op.arma.recarga = (ar & 4) === 4 ? 0.5 : 0;
        a.op.arma.pitch += ((d.ap ?? 0) - a.op.arma.pitch) * f;
      }
      a.op.atualizar(dt);
    }
  }
}

// ---------- bytes (alterações do terreno pela rede e a obra salva) ----------

export function mmParaBuffer(mm: Int16Array): ArrayBuffer {
  return mm.buffer.slice(mm.byteOffset, mm.byteOffset + mm.byteLength) as ArrayBuffer;
}

export function bufferParaMm(dado: unknown): Int16Array {
  if (dado instanceof ArrayBuffer) return new Int16Array(dado);
  const v = dado as ArrayBufferView;
  return new Int16Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer);
}

export function mmParaTexto(mm: Int16Array): string {
  const bytes = new Uint8Array(mm.buffer, mm.byteOffset, mm.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

export function textoParaMm(texto: string): Int16Array {
  const s = atob(texto);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
