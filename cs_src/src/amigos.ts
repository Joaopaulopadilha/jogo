// amigos.ts
// Lista de amigos e convites sem servidor próprio.
//
// Cada pessoa tem um ID fixo (aleatório, guardado no navegador) registrado no servidor do PeerJS.
// O "código de amigo" = ID + segredo de convite. Quem cola o código de alguém passa a conhecer o ID
// e o segredo dele; toda conexão entre amigos faz um desafio HMAC nos dois sentidos, então só quem
// tem o segredo consegue se passar por amigo ou mandar convite.

import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { normalizarCodigo } from "./net";

const PREFIXO = "cscaps-u-";
const CHAVE = "cs_amigos";
const REPETIR_MS = 15000;   // de quanto em quanto tempo procura amigos offline
const TIMEOUT_MS = 8000;    // tempo máximo para completar o handshake
const RE_ID = /^[a-z0-9]{20}$/;
const RE_CODIGO = /^([a-z0-9]{20})\.([a-z0-9]{20})$/;

export interface Amigo {
  id: string;
  nome: string;
  secret: string;
  confirmado: boolean; // o outro lado já reconheceu você (handshake concluído ao menos uma vez)
}

interface Armazem {
  meuId: string;
  convite: string; // segredo do seu código de amigo
  amigos: Amigo[];
}

export type Estado = "indisponivel" | "conectando" | "pronto" | "ocupado" | "erro";

export interface AmigosEventos {
  aoMudar(): void;
  aoConvite(de: Amigo, sala: string): void;
  aoAviso(msg: string): void;
}

const ALFABETO = "abcdefghijklmnopqrstuvwxyz0123456789";

function aleatorio(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ALFABETO[b % ALFABETO.length];
  return s;
}

async function hmac(segredo: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const chave = await crypto.subtle.importKey("raw", enc.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", chave, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function limparNome(n: unknown): string {
  return typeof n === "string" ? n.trim().slice(0, 14) : "";
}

function carregar(): Armazem {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (bruto) {
      const d = JSON.parse(bruto) as Armazem;
      if (RE_ID.test(d.meuId) && RE_ID.test(d.convite) && Array.isArray(d.amigos)) {
        d.amigos = d.amigos.filter((a) => RE_ID.test(a.id) && RE_ID.test(a.secret));
        return d;
      }
    }
  } catch { /* dados corrompidos: gera novos */ }
  return { meuId: aleatorio(20), convite: aleatorio(20), amigos: [] };
}

export class Amigos {
  estado: Estado = "conectando";

  private dados: Armazem;
  private peer: Peer | null = null;
  private online = new Map<string, DataConnection>(); // id do amigo -> conexão autenticada
  private tentando = new Set<string>();
  private timer: number | undefined;
  private reconexao: number | undefined;

  constructor(private nome: () => string, private ev: AmigosEventos) {
    if (typeof crypto === "undefined" || !crypto.subtle) {
      // WebCrypto só existe em https ou localhost
      this.estado = "indisponivel";
      this.dados = { meuId: "", convite: "", amigos: [] };
      return;
    }
    this.dados = carregar();
    this.salvar();
  }

  get codigo(): string {
    return this.estado === "indisponivel" ? "" : `${this.dados.meuId}.${this.dados.convite}`;
  }

  lista(): { amigo: Amigo; online: boolean }[] {
    return this.dados.amigos.map((amigo) => ({ amigo, online: this.online.get(amigo.id)?.open === true }));
  }

  totalOnline(): number {
    return this.lista().filter((x) => x.online).length;
  }

  private salvar(): void {
    try { localStorage.setItem(CHAVE, JSON.stringify(this.dados)); } catch { /* sem armazenamento */ }
  }

  // ---- Ciclo de vida ----

  iniciar(): void {
    if (this.estado === "indisponivel" || this.peer) return;
    this.estado = "conectando";
    this.ev.aoMudar();

    const peer = new Peer(PREFIXO + this.dados.meuId);
    this.peer = peer;

    peer.on("open", () => {
      this.estado = "pronto";
      this.ev.aoMudar();
      this.procurar();
      this.timer = window.setInterval(() => this.procurar(), REPETIR_MS);
    });
    peer.on("connection", (conn) => this.receber(conn));
    peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") return; // amigo offline: esperado
      if (err.type === "unavailable-id") {
        // o mesmo ID já está ativo (outra aba/janela do mesmo navegador)
        this.parar();
        this.estado = "ocupado";
        this.ev.aoMudar();
        return;
      }
      if (this.estado !== "pronto") {
        this.parar();
        this.estado = "erro";
        this.ev.aoMudar();
        this.reconexao = window.setTimeout(() => { this.estado = "conectando"; this.iniciar(); }, 10000);
      }
    });
  }

  parar(): void {
    window.clearInterval(this.timer);
    window.clearTimeout(this.reconexao);
    for (const c of this.online.values()) { try { c.close(); } catch { /* ignore */ } }
    this.online.clear();
    this.tentando.clear();
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.peer = null;
  }

  // ---- Gerenciar amigos ----

  // retorna uma mensagem de erro, ou null se deu certo
  adicionar(texto: string): string | null {
    if (this.estado === "indisponivel") return "Amigos exige https ou localhost.";
    const m = RE_CODIGO.exec(texto.trim().toLowerCase());
    if (!m) return "Código inválido. Cole o código de amigo completo.";
    const [, id, secret] = m;
    if (id === this.dados.meuId) return "Esse é o seu próprio código.";
    if (this.dados.amigos.some((a) => a.id === id)) return "Essa pessoa já está na sua lista.";
    const amigo: Amigo = { id, nome: "Amigo", secret, confirmado: false };
    this.dados.amigos.push(amigo);
    this.salvar();
    this.ev.aoMudar();
    this.conectarA(amigo);
    return null;
  }

  remover(id: string): void {
    this.dados.amigos = this.dados.amigos.filter((a) => a.id !== id);
    this.salvar();
    const c = this.online.get(id);
    this.online.delete(id);
    try { c?.close(); } catch { /* ignore */ }
    this.ev.aoMudar();
  }

  // novo segredo: quem ainda não te adicionou não consegue mais usar o código antigo
  novoCodigo(): void {
    if (this.estado === "indisponivel") return;
    this.dados.convite = aleatorio(20);
    this.salvar();
    this.ev.aoMudar();
  }

  convidar(id: string, sala: string): boolean {
    const c = this.online.get(id);
    if (!c || !c.open) return false;
    c.send({ t: "convite", sala });
    return true;
  }

  // ---- Procurar amigos ----

  private procurar(): void {
    if (!this.peer || this.estado !== "pronto") return;
    for (const a of this.dados.amigos) {
      if (this.online.get(a.id)?.open || this.tentando.has(a.id)) continue;
      // evita as duas pontas ligarem ao mesmo tempo: o menor ID inicia, salvo se ainda não foi confirmado
      if (!a.confirmado || this.dados.meuId < a.id) this.conectarA(a);
    }
  }

  // ---- Handshake: quem liga ----

  private conectarA(amigo: Amigo): void {
    if (!this.peer || this.estado !== "pronto" || this.tentando.has(amigo.id)) return;
    this.tentando.add(amigo.id);

    const conn = this.peer.connect(PREFIXO + amigo.id, { reliable: true });
    const meuNonce = aleatorio(24);
    let autenticado = false;

    const limite = window.setTimeout(() => { if (!autenticado) { try { conn.close(); } catch { /* ignore */ } } }, TIMEOUT_MS);
    const encerrar = () => { window.clearTimeout(limite); this.tentando.delete(amigo.id); };

    conn.on("open", () => {
      conn.send({ t: "oi", id: this.dados.meuId, nome: limparNome(this.nome()), n: meuNonce });
    });
    conn.on("close", encerrar);
    conn.on("error", encerrar);

    conn.on("data", async (dado) => {
      const m = dado as { t?: string; n?: unknown; mac?: unknown; nome?: unknown };
      if (autenticado) { this.tratar(amigo.id, m); return; }
      if (m.t !== "prova" || typeof m.mac !== "string" || typeof m.n !== "string" || m.n.length > 64) return;

      // o outro lado precisa provar que conhece o segredo
      const esperado = await hmac(amigo.secret, `R|${meuNonce}|${amigo.id}`);
      if (esperado !== m.mac) { conn.close(); return; }
      autenticado = true;
      encerrar();
      conn.send({ t: "prova2", mac: await hmac(amigo.secret, `I|${m.n}|${this.dados.meuId}`) });
      this.registrar(amigo.id, conn, limparNome(m.nome));
    });
  }

  // ---- Handshake: quem recebe ----

  private receber(conn: DataConnection): void {
    let idRemoto = "";
    let nomeRemoto = "";
    let nonceRemoto = "";
    let segredo = "";
    let conhecido = false;
    let autenticado = false;
    const meuNonce = aleatorio(24);

    const limite = window.setTimeout(() => { if (!autenticado) { try { conn.close(); } catch { /* ignore */ } } }, TIMEOUT_MS);
    conn.on("close", () => window.clearTimeout(limite));

    conn.on("data", async (dado) => {
      const m = dado as { t?: string; id?: unknown; n?: unknown; mac?: unknown; nome?: unknown };
      if (autenticado) { this.tratar(idRemoto, m); return; }

      if (m.t === "oi" && !idRemoto) {
        if (typeof m.id !== "string" || !RE_ID.test(m.id) || typeof m.n !== "string" || m.n.length > 64) { conn.close(); return; }
        idRemoto = m.id;
        nonceRemoto = m.n;
        nomeRemoto = limparNome(m.nome);
        const amigo = this.dados.amigos.find((a) => a.id === idRemoto);
        conhecido = !!amigo;
        // desconhecido só entra se souber o segredo do seu código de amigo
        segredo = amigo ? amigo.secret : this.dados.convite;
        conn.send({
          t: "prova",
          n: meuNonce,
          mac: await hmac(segredo, `R|${nonceRemoto}|${this.dados.meuId}`),
          nome: limparNome(this.nome()),
        });
        return;
      }

      if (m.t === "prova2" && idRemoto && typeof m.mac === "string") {
        const esperado = await hmac(segredo, `I|${meuNonce}|${idRemoto}`);
        if (esperado !== m.mac) { conn.close(); return; }
        autenticado = true;
        window.clearTimeout(limite);

        const existente = this.dados.amigos.find((a) => a.id === idRemoto);
        if (existente) {
          existente.confirmado = true;
        } else if (!conhecido) {
          this.dados.amigos.push({ id: idRemoto, nome: nomeRemoto || "Amigo", secret: segredo, confirmado: true });
          this.ev.aoAviso(`${nomeRemoto || "Alguém"} entrou na sua lista de amigos.`);
        }
        this.registrar(idRemoto, conn, nomeRemoto);
      }
    });
  }

  // ---- Conexão autenticada ----

  private registrar(id: string, conn: DataConnection, nome: string): void {
    const amigo = this.dados.amigos.find((a) => a.id === id);
    if (!amigo) { conn.close(); return; }
    if (nome) amigo.nome = nome;
    amigo.confirmado = true;
    this.salvar();

    const atual = this.online.get(id);
    if (atual && atual.open && atual !== conn) { conn.close(); return; }
    this.online.set(id, conn);
    conn.on("close", () => {
      if (this.online.get(id) === conn) { this.online.delete(id); this.ev.aoMudar(); }
    });
    this.ev.aoMudar();
  }

  private tratar(id: string, m: { t?: string; sala?: unknown }): void {
    const amigo = this.dados.amigos.find((a) => a.id === id);
    if (!amigo) return;
    if (m.t === "convite" && typeof m.sala === "string") {
      const sala = normalizarCodigo(m.sala);
      if (sala) this.ev.aoConvite(amigo, sala);
    }
  }
}
