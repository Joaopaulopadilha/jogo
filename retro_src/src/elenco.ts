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
}

interface Avatar {
  nome: string;
  op: Operario;
  alvo: DadosJogador;
  primeiro: boolean; // ainda não recebeu posição: aparece direto no lugar, sem deslizar
}

function etiqueta(nome: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "bold 30px 'Segoe UI', system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const larg = Math.min(248, g.measureText(nome).width + 28);
  g.fillStyle = "rgba(20,22,26,0.78)";
  g.beginPath();
  g.roundRect((256 - larg) / 2, 8, larg, 48, 14);
  g.fill();
  g.fillStyle = "#ffd34d";
  g.fillText(nome, 128, 33, 224);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  s.position.y = 2.25;
  s.renderOrder = 5;
  return s;
}

export class Elenco {
  private readonly avatares = new Map<string, Avatar>();

  constructor(private readonly cena: THREE.Scene, private readonly banco: THREE.Object3D, private readonly modelo: string) {}

  get nomes(): [string, string][] {
    return [...this.avatares].map(([uid, a]) => [uid, a.nome]);
  }

  atualizar(uid: string, nome: string, dados: DadosJogador): void {
    let a = this.avatares.get(uid);
    if (!a) {
      const op = new Operario();
      op.grupo.add(etiqueta(nome));
      this.cena.add(op.grupo);
      void op.carregar(this.modelo);
      a = { nome, op, alvo: dados, primeiro: true };
      this.avatares.set(uid, a);
    }
    a.alvo = dados;
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

  // condutor = quem está sentado na cabine (acompanha a máquina)
  animar(dt: number, condutor: string): void {
    const f = 1 - Math.exp(-dt * 12);
    for (const [uid, a] of this.avatares) {
      const g = a.op.grupo;
      if (uid === condutor) {
        if (g.parent !== this.banco) {
          this.banco.add(g);
          g.position.set(0, -0.25, 0);
          g.rotation.set(0, 0, 0);
        }
        a.op.tocar("sentado", 0.3);
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
