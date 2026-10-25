// net.ts
// Camada PeerJS: o host cria a sala (código curto) e cada convidado abre uma conexão com ele.

import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { CORES, MAX_JOGADORES } from "./shared";
import type { GuestMsg, HostMsg, PlayerInfo } from "./types";

// o ID real no servidor do PeerJS leva um prefixo, assim "uva" não colide com IDs de outros apps
const PREFIXO = "cscaps-";
export const CODIGO_MIN = 2;
export const CODIGO_MAX = 12;

// só letras minúsculas e números, sem acentos
export function normalizarCodigo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, CODIGO_MAX);
}

function gerarCodigo(): string {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return c;
}

export interface Convidado {
  conn: DataConnection;
  nome: string;
  pid: number;   // id do jogador na partida (definido ao iniciar)
  ola: boolean;  // já enviou o "hello" (nome e vaga confirmados)
  slot: number;  // vaga pedida pelo convidado (grupo de amigos); sem pedido, vai para o fim
}

export interface HostHandlers {
  aoAbrir(codigo: string): void;
  aoMudarLobby(): void;
  aoMensagem(g: Convidado, m: GuestMsg): void;
  aoSair(g: Convidado): void;
  aoErro(msg: string): void;
}

export class HostNet {
  peer: Peer;
  convidados: Convidado[] = [];
  iniciada = false;

  // codigo vazio gera um aleatório
  constructor(nomeHost: string, codigo: string, private h: HostHandlers) {
    this.nomeHost = nomeHost;
    this.peer = new Peer(PREFIXO + (codigo || gerarCodigo()));
    this.peer.on("open", (id) => h.aoAbrir(id.slice(PREFIXO.length)));
    this.peer.on("error", (err) => h.aoErro(err.type));
    this.peer.on("connection", (conn) => this.novaConexao(conn));
  }

  nomeHost: string;

  private novaConexao(conn: DataConnection): void {
    if (this.iniciada || this.convidados.length + 1 >= MAX_JOGADORES) {
      conn.on("open", () => { try { conn.close(); } catch { /* ignore */ } });
      return;
    }
    const g: Convidado = { conn, nome: `Jogador ${this.convidados.length + 2}`, pid: this.convidados.length + 1, ola: false, slot: 99 };
    this.convidados.push(g);

    conn.on("open", () => this.h.aoMudarLobby());
    conn.on("data", (data) => {
      const m = data as GuestMsg;
      if (m.t === "hello") {
        g.nome = (m.nome || "").trim().slice(0, 14) || g.nome;
        if (typeof m.slot === "number" && m.slot >= 1 && m.slot < MAX_JOGADORES) g.slot = Math.floor(m.slot);
        g.ola = true;
        this.h.aoMudarLobby();
      }
      this.h.aoMensagem(g, m);
    });
    conn.on("close", () => {
      this.convidados = this.convidados.filter((x) => x !== g);
      this.h.aoSair(g);
      if (!this.iniciada) this.h.aoMudarLobby();
    });
  }

  // lista na ordem de ids (host = 0)
  jogadores(): PlayerInfo[] {
    const lista: PlayerInfo[] = [{ id: 0, nome: this.nomeHost || "Jogador 1", cor: CORES[0] }];
    this.convidados.forEach((g, i) => lista.push({ id: i + 1, nome: g.nome, cor: CORES[i + 1] }));
    return lista;
  }

  // fixa os ids de cada convidado (pela vaga no grupo, se houver), completa com CPUs e avisa todos
  iniciar(cpus = 0): PlayerInfo[] {
    this.iniciada = true;
    this.convidados.sort((a, b) => a.slot - b.slot);
    this.convidados.forEach((g, i) => { g.pid = i + 1; });
    const players = this.jogadores();
    for (let i = 1; i <= cpus && players.length < MAX_JOGADORES; i++) {
      players.push({ id: players.length, nome: `CPU ${i}`, cor: CORES[players.length] });
    }
    this.enviarLobby("start", players);
    return players;
  }

  reenviarInicio(players: PlayerInfo[]): void {
    this.enviarLobby("start", players);
  }

  enviarLobby(t: "lobby" | "start", players: PlayerInfo[]): void {
    for (const g of this.convidados) {
      this.enviar(g, { t, players, you: g.pid } as HostMsg);
    }
  }

  enviar(g: Convidado, m: HostMsg): void {
    if (g.conn.open) g.conn.send(m);
  }

  transmitir(m: HostMsg): void {
    for (const g of this.convidados) this.enviar(g, m);
  }

  fechar(): void {
    for (const g of this.convidados) { try { g.conn.close(); } catch { /* ignore */ } }
    this.convidados = [];
    try { this.peer.destroy(); } catch { /* ignore */ }
  }
}

export interface GuestHandlers {
  aoConectar(): void;
  aoMensagem(m: HostMsg): void;
  aoFechar(): void;
  aoErro(msg: string): void;
}

export class GuestNet {
  peer: Peer;
  conn: DataConnection | null = null;

  constructor(codigo: string, nome: string, h: GuestHandlers, slot?: number) {
    this.peer = new Peer();
    this.peer.on("open", () => {
      const conn = this.peer.connect(PREFIXO + codigo, { reliable: true });
      this.conn = conn;
      conn.on("open", () => {
        conn.send({ t: "hello", nome, slot } satisfies GuestMsg);
        h.aoConectar();
      });
      conn.on("data", (data) => h.aoMensagem(data as HostMsg));
      conn.on("close", () => h.aoFechar());
    });
    this.peer.on("error", (err) => h.aoErro(err.type));
  }

  enviar(m: GuestMsg): void {
    if (this.conn && this.conn.open) this.conn.send(m);
  }

  fechar(): void {
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer.destroy(); } catch { /* ignore */ }
    this.conn = null;
  }
}
