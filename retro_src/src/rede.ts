import Peer from "peerjs";
import type { DataConnection } from "peerjs";

// Sala por palavra (mesmo modelo do /dev): o anfitrião registra o id "retro-<palavra>" no servidor do PeerJS
// (que só apresenta um ao outro) e cada convidado liga direto nele. Os dois lados religam sozinhos.

const PREFIXO = "retro-";
const RELIGAR_MS = 3000;
const ESPERA_CONEXAO_MS = 10000;
const BATIDA_MS = 5000;
const SILENCIO_MAX_MS = 20000;

export type Msg = { t: string; [k: string]: unknown };

// só letras minúsculas e números, sem acentos
export function normalizarPalavra(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 16);
}

const PALAVRAS = ["barro", "pedra", "areia", "tatu", "vala", "cone", "pa", "terra", "tijolo", "cimento", "obra", "brita", "enxada", "betao"];
export function palavraAleatoria(): string {
  return PALAVRAS[Math.floor(Math.random() * PALAVRAS.length)] + Math.floor(10 + Math.random() * 90);
}

// religa no servidor quando a conexão com ele cai (aba no fundo, Wi-Fi oscilou): sem isso ninguém novo chega
function manterNoServidor(peer: Peer): void {
  const religar = (): void => {
    if (peer.disconnected && !peer.destroyed) {
      try { peer.reconnect(); } catch { /* ignora */ }
    }
  };
  peer.on("disconnected", () => setTimeout(religar, RELIGAR_MS));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) religar(); });
  addEventListener("online", religar);
}

// ---------------- anfitrião ----------------

export interface Ligado {
  conn: DataConnection;
  uid: string; // identidade fixa do jogador (guardada no navegador dele): é por ela que ele volta ao mesmo lugar
  nome: string;
  visto: number;
}

export interface EventosAnfitriao {
  aoAbrir(): void;
  aoErro(tipo: string): void;
  aoEntrou(l: Ligado): void;
  aoSaiu(l: Ligado): void;
  aoMensagem(l: Ligado, m: Msg): void;
}

export class Anfitriao {
  readonly ligados = new Map<string, Ligado>(); // uid -> ligação
  private peer!: Peer;
  private tentativas = 0;
  private readonly vigia: number;

  constructor(readonly palavra: string, private readonly ev: EventosAnfitriao) {
    this.abrir();
    this.vigia = window.setInterval(() => this.conferirSilencio(), BATIDA_MS);
  }

  private abrir(): void {
    const peer = new Peer(PREFIXO + this.palavra, { debug: 0 });
    this.peer = peer;
    let abriu = false;
    peer.on("open", () => {
      abriu = true;
      this.tentativas = 0;
      this.ev.aoAbrir();
    });
    peer.on("connection", (conn) => this.nova(conn));
    peer.on("error", (err) => {
      if (err.type === "unavailable-id" && !abriu) {
        // quase sempre é o registro antigo desta mesma sala (o anfitrião recarregou): o servidor demora alguns
        // segundos para esquecer. Insiste um pouco antes de dizer que a palavra está em uso
        try { peer.destroy(); } catch { /* ignora */ }
        if (++this.tentativas <= 5) setTimeout(() => this.abrir(), RELIGAR_MS);
        else this.ev.aoErro("palavra-em-uso");
        return;
      }
      if (err.type === "peer-unavailable") return;
      this.ev.aoErro(err.type);
    });
    manterNoServidor(peer);
  }

  private nova(conn: DataConnection): void {
    let l: Ligado | null = null;
    conn.on("data", (dado) => {
      const m = dado as Msg;
      if (!m || typeof m !== "object") return;
      if (m.t === "ola") {
        const uid = String(m.uid || "").slice(0, 40);
        if (!uid) return;
        const antigo = this.ligados.get(uid);
        if (antigo && antigo.conn !== conn) {
          // o mesmo jogador voltou (recarregou ou a internet caiu): a ligação nova substitui a velha
          this.ligados.delete(uid);
          try { antigo.conn.close(); } catch { /* ignora */ }
        }
        l = { conn, uid, nome: String(m.nome || "Operário").slice(0, 16), visto: Date.now() };
        this.ligados.set(uid, l);
        this.ev.aoEntrou(l);
        return;
      }
      if (!l) return;
      l.visto = Date.now();
      if (m.t === "ping") return;
      this.ev.aoMensagem(l, m);
    });
    const saiu = (): void => {
      if (l && this.ligados.get(l.uid) === l) {
        this.ligados.delete(l.uid);
        this.ev.aoSaiu(l);
      }
    };
    conn.on("close", saiu);
    conn.on("error", saiu);
  }

  // convidado que sumiu sem a conexão avisar (celular bloqueado, Wi-Fi caiu)
  private conferirSilencio(): void {
    const agora = Date.now();
    for (const l of [...this.ligados.values()]) {
      if (agora - l.visto > SILENCIO_MAX_MS) {
        this.ligados.delete(l.uid);
        try { l.conn.close(); } catch { /* ignora */ }
        this.ev.aoSaiu(l);
      }
    }
  }

  enviar(uid: string, m: Msg): void {
    const l = this.ligados.get(uid);
    if (l && l.conn.open) { try { l.conn.send(m); } catch { /* ignora */ } }
  }

  transmitir(m: Msg): void {
    for (const l of this.ligados.values()) {
      if (l.conn.open) { try { l.conn.send(m); } catch { /* ignora */ } }
    }
  }

  fechar(): void {
    clearInterval(this.vigia);
    for (const l of this.ligados.values()) { try { l.conn.close(); } catch { /* ignora */ } }
    this.ligados.clear();
    try { this.peer.destroy(); } catch { /* ignora */ }
  }
}

// ---------------- convidado ----------------

export interface EventosConvidado {
  aoConectar(): void;
  aoDesconectar(): void;
  aoMensagem(m: Msg): void;
  aoEstado(texto: string): void;
}

export class Convidado {
  conectado = false;
  private conn: DataConnection | null = null;
  private fechado = false;
  private timer = 0;
  private readonly peer: Peer;
  private readonly batida: number;

  constructor(readonly palavra: string, private readonly uid: string, private readonly nome: string, private readonly ev: EventosConvidado) {
    this.peer = new Peer({ debug: 0 });
    this.peer.on("open", () => { if (!this.conn) this.conectar(); });
    this.peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        this.ev.aoEstado("Esperando o anfitrião abrir a sala...");
        this.agendar();
      } else if (["network", "server-error", "socket-error", "socket-closed"].includes(err.type)) {
        this.ev.aoEstado("Sem conexão com o servidor, tentando de novo...");
      }
    });
    manterNoServidor(this.peer);
    this.batida = window.setInterval(() => this.enviar({ t: "ping" }), BATIDA_MS);
  }

  private agendar(): void {
    if (this.fechado) return;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.conectar(), RELIGAR_MS);
  }

  private conectar(): void {
    if (this.fechado || this.peer.destroyed) return;
    if (this.peer.disconnected) { this.agendar(); return; }
    clearTimeout(this.timer);
    if (this.conn) {
      const velha = this.conn;
      this.conn = null;
      try { velha.close(); } catch { /* ignora */ }
    }
    this.ev.aoEstado("Conectando...");
    const conn = this.peer.connect(PREFIXO + this.palavra, { reliable: true });
    this.conn = conn;
    const espera = window.setTimeout(() => {
      if (conn.open || this.conn !== conn) return;
      this.conn = null;
      try { conn.close(); } catch { /* ignora */ }
      this.ev.aoEstado("O anfitrião não respondeu, tentando de novo...");
      this.agendar();
    }, ESPERA_CONEXAO_MS);
    conn.on("open", () => {
      clearTimeout(espera);
      conn.send({ t: "ola", uid: this.uid, nome: this.nome });
      this.conectado = true;
      this.ev.aoConectar();
    });
    conn.on("data", (m) => {
      if (this.conn === conn && m && typeof m === "object") this.ev.aoMensagem(m as Msg);
    });
    const perdeu = (): void => {
      clearTimeout(espera);
      if (this.conn !== conn) return;
      this.conn = null;
      if (this.conectado) {
        this.conectado = false;
        this.ev.aoDesconectar();
      }
      this.agendar();
    };
    conn.on("close", perdeu);
    conn.on("error", perdeu);
  }

  enviar(m: Msg): void {
    if (this.conn && this.conn.open) { try { this.conn.send(m); } catch { /* ignora */ } }
  }

  fechar(): void {
    this.fechado = true;
    clearTimeout(this.timer);
    clearInterval(this.batida);
    try { this.conn?.close(); } catch { /* ignora */ }
    try { this.peer.destroy(); } catch { /* ignora */ }
  }
}
