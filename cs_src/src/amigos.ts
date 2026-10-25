// amigos.ts
// Lista de amigos e convites sem servidor próprio.
//
// Cada pessoa tem um apelido de amigo (3 a 12 letras/números, escolhido por ela) que é o ID dela no
// servidor do PeerJS. Para virar amigo, um lado envia um pedido pelo apelido e o outro aceita; nessa hora
// quem aceita gera um segredo, que passa a ser compartilhado só entre os dois. Dali em diante toda
// conexão faz um desafio HMAC nos dois sentidos: o apelido sozinho não basta para se passar por amigo
// nem para mandar convite.

import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { normalizarCodigo } from "./net";

const PREFIXO = "cscaps-u-";
const CHAVE = "cs_amigos";
const REPETIR_MS = 15000;   // de quanto em quanto tempo procura amigos offline
const TIMEOUT_MS = 8000;    // tempo máximo para completar o handshake
const MAX_PEDIDOS = 5;      // pedidos de amizade pendentes ao mesmo tempo

export const APELIDO_MIN = 3;
export const APELIDO_MAX = 12;
const RE_APELIDO = /^[a-z0-9]{3,20}$/;  // aceita também os IDs longos de versões antigas
const RE_SEGREDO = /^[a-z0-9]{20}$/;

export interface Amigo {
  id: string;        // apelido do amigo
  nome: string;      // nome de jogador dele (atualizado a cada conexão)
  secret: string;    // "" = pedido enviado, ainda não aceito
  confirmado: boolean; // o outro lado já reconheceu você (handshake concluído ao menos uma vez)
}

interface Armazem {
  meuId: string;
  amigos: Amigo[];
}

export interface Pedido {
  id: string;
  nome: string;
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

// valida e normaliza um apelido digitado; retorna null se for inválido
export function apelidoValido(texto: string): string | null {
  const a = normalizarCodigo(texto).slice(0, APELIDO_MAX);
  return a.length >= APELIDO_MIN ? a : null;
}

type Memoria = Pick<Storage, "getItem" | "setItem">;

function carregar(store?: Memoria): Armazem {
  try {
    const bruto = (store ?? localStorage).getItem(CHAVE);
    if (bruto) {
      const d = JSON.parse(bruto) as Armazem;
      if (RE_APELIDO.test(d.meuId) && Array.isArray(d.amigos)) {
        d.amigos = d.amigos.filter((a) => RE_APELIDO.test(a.id) && (a.secret === "" || RE_SEGREDO.test(a.secret)));
        return { meuId: d.meuId, amigos: d.amigos };
      }
    }
  } catch { /* dados corrompidos: gera novos */ }
  return { meuId: aleatorio(10), amigos: [] };
}

// o ID do outro lado vem do servidor de sinalização (conn.peer), não do que ele diz ser
function idDaConexao(conn: DataConnection): string {
  return conn.peer.startsWith(PREFIXO) ? conn.peer.slice(PREFIXO.length) : "";
}

export class Amigos {
  estado: Estado = "conectando";

  private dados: Armazem;
  private peer: Peer | null = null;
  private online = new Map<string, DataConnection>(); // apelido -> conexão autenticada
  private pedidosRecebidos = new Map<string, { nome: string; conn: DataConnection }>();
  private tentando = new Set<string>();
  private timer: number | undefined;
  private reconexao: number | undefined;

  constructor(
    private nome: () => string,
    private ev: AmigosEventos,
    private criarPeer: (id: string) => Peer = (id) => new Peer(id),
    private store?: Memoria,
  ) {
    if (typeof crypto === "undefined" || !crypto.subtle) {
      // WebCrypto só existe em https ou localhost
      this.estado = "indisponivel";
      this.dados = { meuId: "", amigos: [] };
      return;
    }
    this.dados = carregar(store);
    this.salvar();
  }

  get apelido(): string {
    return this.dados.meuId;
  }

  lista(): { amigo: Amigo; online: boolean; pendente: boolean }[] {
    return this.dados.amigos.map((amigo) => ({
      amigo,
      online: this.online.get(amigo.id)?.open === true,
      pendente: amigo.secret === "",
    }));
  }

  pedidos(): Pedido[] {
    return [...this.pedidosRecebidos].map(([id, p]) => ({ id, nome: p.nome }));
  }

  totalOnline(): number {
    return this.lista().filter((x) => x.online).length;
  }

  private salvar(): void {
    try { (this.store ?? localStorage).setItem(CHAVE, JSON.stringify(this.dados)); } catch { /* sem armazenamento */ }
  }

  // ---- Ciclo de vida ----

  iniciar(): void {
    if (this.estado === "indisponivel" || this.peer) return;
    this.estado = "conectando";
    this.ev.aoMudar();

    const peer = this.criarPeer(PREFIXO + this.dados.meuId);
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
        // o apelido já está em uso (outra pessoa, ou outra aba deste navegador)
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
    for (const p of this.pedidosRecebidos.values()) { try { p.conn.close(); } catch { /* ignore */ } }
    this.online.clear();
    this.pedidosRecebidos.clear();
    this.tentando.clear();
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.peer = null;
  }

  // ---- Meu apelido ----

  // trocar o apelido desfaz as amizades: os amigos conhecem o apelido antigo
  trocarApelido(texto: string): string | null {
    if (this.estado === "indisponivel") return "Amigos exige https ou localhost.";
    const novo = apelidoValido(texto);
    if (!novo) return `O apelido precisa ter de ${APELIDO_MIN} a ${APELIDO_MAX} letras ou números.`;
    if (novo === this.dados.meuId && this.estado !== "ocupado") return null;
    this.parar();
    this.dados = { meuId: novo, amigos: [] };
    this.salvar();
    this.estado = "conectando";
    this.iniciar();
    return null;
  }

  // ---- Gerenciar amigos ----

  // envia um pedido de amizade; retorna uma mensagem de erro, ou null se deu certo
  adicionar(texto: string): string | null {
    if (this.estado === "indisponivel") return "Amigos exige https ou localhost.";
    const id = apelidoValido(texto);
    if (!id) return `Digite o apelido do amigo (${APELIDO_MIN} a ${APELIDO_MAX} letras ou números).`;
    if (id === this.dados.meuId) return "Esse é o seu próprio apelido.";
    if (this.dados.amigos.some((a) => a.id === id)) return "Essa pessoa já está na sua lista.";
    const amigo: Amigo = { id, nome: id, secret: "", confirmado: false };
    this.dados.amigos.push(amigo);
    this.salvar();
    this.ev.aoMudar();
    this.pedirA(amigo);
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

  aceitar(id: string): void {
    const p = this.pedidosRecebidos.get(id);
    if (!p) return;
    this.pedidosRecebidos.delete(id);
    this.fecharOnline(id); // se já era amigo, o segredo antigo deixa de valer
    const segredo = aleatorio(20);
    this.guardarAmigo(id, p.nome, segredo);
    p.conn.send({ t: "aceito", s: segredo, nome: limparNome(this.nome()) });
    window.setTimeout(() => { try { p.conn.close(); } catch { /* ignore */ } }, 1000);
    this.ev.aoMudar();
  }

  recusar(id: string): void {
    const p = this.pedidosRecebidos.get(id);
    if (!p) return;
    this.pedidosRecebidos.delete(id);
    try { p.conn.send({ t: "recusado" }); } catch { /* ignore */ }
    window.setTimeout(() => { try { p.conn.close(); } catch { /* ignore */ } }, 500);
    this.ev.aoMudar();
  }

  convidar(id: string, sala: string): boolean {
    const c = this.online.get(id);
    if (!c || !c.open) return false;
    c.send({ t: "convite", sala });
    return true;
  }

  private guardarAmigo(id: string, nome: string, segredo: string): void {
    const existente = this.dados.amigos.find((a) => a.id === id);
    if (existente) {
      existente.secret = segredo;
      existente.confirmado = true;
      if (nome) existente.nome = nome;
    } else {
      this.dados.amigos.push({ id, nome: nome || id, secret: segredo, confirmado: true });
    }
    this.salvar();
  }

  private fecharOnline(id: string): void {
    const c = this.online.get(id);
    this.online.delete(id);
    try { c?.close(); } catch { /* ignore */ }
  }

  // ---- Procurar amigos ----

  private procurar(): void {
    if (!this.peer || this.estado !== "pronto") return;
    for (const a of this.dados.amigos) {
      if (this.online.get(a.id)?.open || this.tentando.has(a.id)) continue;
      if (a.secret === "") { this.pedirA(a); continue; }
      // evita as duas pontas ligarem ao mesmo tempo: o menor ID inicia, salvo se ainda não foi confirmado
      if (!a.confirmado || this.dados.meuId < a.id) this.conectarA(a);
    }
  }

  // ---- Pedido de amizade: quem envia ----

  private pedirA(amigo: Amigo): void {
    if (!this.peer || this.estado !== "pronto" || this.tentando.has(amigo.id)) return;
    this.tentando.add(amigo.id);

    const conn = this.peer.connect(PREFIXO + amigo.id, { reliable: true });
    let aguardando = false;
    const encerrar = () => { window.clearTimeout(limite); this.tentando.delete(amigo.id); };
    // conexão que nunca abriu (amigo offline) não emite "close": limpa a tentativa aqui mesmo
    const limite = window.setTimeout(() => {
      if (aguardando) return;
      encerrar();
      try { conn.close(); } catch { /* ignore */ }
    }, TIMEOUT_MS);

    conn.on("open", () => conn.send({ t: "pedido", nome: limparNome(this.nome()) }));
    conn.on("close", encerrar);
    conn.on("error", encerrar);

    conn.on("data", (dado) => {
      const m = dado as { t?: string; s?: unknown; nome?: unknown };
      const atual = this.dados.amigos.find((a) => a.id === amigo.id);
      if (!atual) { try { conn.close(); } catch { /* ignore */ } return; }

      if (m.t === "aguardando") {
        // o outro lado está online e vai decidir: não precisa insistir
        aguardando = true;
        window.clearTimeout(limite);
      } else if (m.t === "aceito" && typeof m.s === "string" && RE_SEGREDO.test(m.s)) {
        if (atual.secret) return;
        this.guardarAmigo(amigo.id, limparNome(m.nome), m.s);
        this.cancelarPedidoRecebido(amigo.id);
        this.ev.aoAviso(`${atual.nome} aceitou seu pedido de amizade.`);
        this.ev.aoMudar();
        encerrar();
        try { conn.close(); } catch { /* ignore */ }
        this.conectarA(atual);
      } else if (m.t === "recusado") {
        this.dados.amigos = this.dados.amigos.filter((a) => a.id !== amigo.id);
        this.salvar();
        this.ev.aoAviso(`${amigo.id} recusou seu pedido de amizade.`);
        this.ev.aoMudar();
        try { conn.close(); } catch { /* ignore */ }
      }
    });
  }

  // ---- Pedido de amizade: quem recebe ----

  private registrarPedido(id: string, nome: string, conn: DataConnection): void {
    const meu = this.dados.amigos.find((a) => a.id === id);

    // os dois se adicionaram ao mesmo tempo: o menor apelido decide o segredo, o outro espera receber
    if (meu && meu.secret === "") {
      if (this.dados.meuId < id) {
        const segredo = aleatorio(20);
        this.guardarAmigo(id, nome, segredo);
        conn.send({ t: "aceito", s: segredo, nome: limparNome(this.nome()) });
        window.setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 1000);
        this.ev.aoAviso(`${nome || id} agora é seu amigo.`);
        this.ev.aoMudar();
      } else {
        conn.send({ t: "aguardando" });
      }
      return;
    }

    if (!this.pedidosRecebidos.has(id) && this.pedidosRecebidos.size >= MAX_PEDIDOS) {
      conn.send({ t: "recusado" });
      try { conn.close(); } catch { /* ignore */ }
      return;
    }
    const anterior = this.pedidosRecebidos.get(id);
    if (anterior && anterior.conn !== conn) { try { anterior.conn.close(); } catch { /* ignore */ } }

    this.pedidosRecebidos.set(id, { nome: nome || id, conn });
    conn.on("close", () => {
      if (this.pedidosRecebidos.get(id)?.conn === conn) {
        this.pedidosRecebidos.delete(id);
        this.ev.aoMudar();
      }
    });
    conn.send({ t: "aguardando" });
    this.ev.aoAviso(`${nome || id} quer ser seu amigo.`);
    this.ev.aoMudar();
  }

  private cancelarPedidoRecebido(id: string): void {
    const p = this.pedidosRecebidos.get(id);
    if (!p) return;
    this.pedidosRecebidos.delete(id);
    try { p.conn.close(); } catch { /* ignore */ }
  }

  // ---- Handshake: quem liga ----

  private conectarA(amigo: Amigo): void {
    if (!this.peer || this.estado !== "pronto" || this.tentando.has(amigo.id) || !amigo.secret) return;
    this.tentando.add(amigo.id);

    const conn = this.peer.connect(PREFIXO + amigo.id, { reliable: true });
    const meuNonce = aleatorio(24);
    let autenticado = false;

    const encerrar = () => { window.clearTimeout(limite); this.tentando.delete(amigo.id); };
    const limite = window.setTimeout(() => {
      if (autenticado) return;
      encerrar();
      try { conn.close(); } catch { /* ignore */ }
    }, TIMEOUT_MS);

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

  // ---- Conexões recebidas: pedido de amizade ou handshake de amigo ----

  private receber(conn: DataConnection): void {
    const idConexao = idDaConexao(conn);
    let idRemoto = "";
    let nomeRemoto = "";
    let nonceRemoto = "";
    let segredo = "";
    let autenticado = false;
    let pedido = false;
    const meuNonce = aleatorio(24);

    const limite = window.setTimeout(() => { if (!autenticado && !pedido) { try { conn.close(); } catch { /* ignore */ } } }, TIMEOUT_MS);
    conn.on("close", () => window.clearTimeout(limite));

    conn.on("data", async (dado) => {
      const m = dado as { t?: string; id?: unknown; n?: unknown; mac?: unknown; nome?: unknown };
      if (autenticado) { this.tratar(idRemoto, m); return; }
      if (pedido) return;

      if (m.t === "pedido" && !idRemoto) {
        if (!RE_APELIDO.test(idConexao) || idConexao === this.dados.meuId) { conn.close(); return; }
        pedido = true;
        window.clearTimeout(limite);
        this.registrarPedido(idConexao, limparNome(m.nome), conn);
        return;
      }

      if (m.t === "oi" && !idRemoto) {
        // o ID informado precisa ser o mesmo que o servidor atribuiu a esta conexão
        if (typeof m.id !== "string" || m.id !== idConexao || typeof m.n !== "string" || m.n.length > 64) { conn.close(); return; }
        const amigo = this.dados.amigos.find((a) => a.id === idConexao);
        if (!amigo || !amigo.secret) { conn.close(); return; } // desconhecido: precisa mandar um pedido
        idRemoto = idConexao;
        nonceRemoto = m.n;
        nomeRemoto = limparNome(m.nome);
        segredo = amigo.secret;
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
