// amigos.ts
// Lista de amigos e convites sem servidor próprio.
//
// Cada pessoa tem um apelido de amigo (3 a 12 letras/números, escolhido por ela) que é o ID dela no
// servidor do PeerJS. Para virar amigo, um lado envia um pedido pelo apelido e o outro aceita; nessa hora
// quem aceita gera um segredo, que passa a ser compartilhado só entre os dois. Dali em diante toda
// conexão faz um desafio HMAC nos dois sentidos: o apelido sozinho não basta para se passar por amigo
// nem para mandar convite.

import Peer from "peerjs";
import type { DataConnection, MediaConnection } from "peerjs";
import { normalizarCodigo } from "./net";

const PREFIXO = "cscaps-u-";

// ID do apelido no servidor do PeerJS (também usado para identificar chamadas de voz)
export const peerIdDeApelido = (apelido: string): string => PREFIXO + apelido;
export const apelidoDePeerId = (peerId: string): string => (peerId.startsWith(PREFIXO) ? peerId.slice(PREFIXO.length) : "");
const CHAVE = "cs_amigos";
const REPETIR_MS = 10000;   // de quanto em quanto tempo procura amigos offline
const RECRIAR_MS = 4000;    // espera antes de recriar a conexão com o servidor
const MAX_RECUPERACOES = 8; // tentativas seguidas de recuperar o apelido depois de uma queda
const BATIDA_MS = 5000;     // de quanto em quanto tempo os amigos conectados trocam um sinal de vida
const LIMITE_SINAL_MS = 20000; // sem nenhum sinal por tanto tempo, o amigo é tratado como offline
const FALHAS_PARA_REFAZER = 3; // handshakes seguidos que falham com um amigo que está online
const TIMEOUT_MS = 8000;    // tempo máximo para completar o handshake
const MAX_PEDIDOS = 5;      // pedidos de amizade pendentes ao mesmo tempo
const VALIDADE_LINK_MS = 3 * 24 * 60 * 60 * 1000; // um link de convite vale 3 dias
const MAX_LINKS = 20;       // links ativos guardados ao mesmo tempo

export const APELIDO_MIN = 3;
export const APELIDO_MAX = 12;
const RE_APELIDO = /^[a-z0-9]{3,20}$/;  // aceita também os IDs longos de versões antigas
const RE_SEGREDO = /^[a-z0-9]{20}$/;
export const RE_TOKEN = /^[a-z0-9]{16}$/;

export interface Amigo {
  id: string;        // apelido do amigo
  nome: string;      // nome de jogador dele (atualizado a cada conexão)
  secret: string;    // "" = pedido enviado, ainda não aceito
  confirmado: boolean; // o outro lado já reconheceu você (handshake concluído ao menos uma vez)
  token?: string;    // código de um link de convite, enviado junto do pedido até ele ser aceito
}

// código de uso único embutido num link de convite: quem o apresenta é aceito sem aprovação manual
interface LinkConvite {
  token: string;
  expira: number; // ms desde 1970
}

interface Armazem {
  meuId: string;
  amigos: Amigo[];
  convites: LinkConvite[];
}

export interface Pedido {
  id: string;
  nome: string;
}

export type Estado = "indisponivel" | "conectando" | "pronto" | "ocupado" | "erro";

// tempos ajustáveis (só os testes mexem)
export interface OpcoesAmigos {
  repetirMs?: number;
  batidaMs?: number;
  limiteSinalMs?: number;
  recriarMs?: number;
  maxRecuperacoes?: number;
  timeoutMs?: number;
}

export interface AmigosEventos {
  aoMudar(): void;
  aoConvite(de: Amigo, sala: string): void;
  aoAviso(msg: string): void;
  // mensagens de grupo ("g-...") vindas de um amigo autenticado
  aoGrupo?(de: Amigo, m: Record<string, unknown>): void;
  // chamada de voz recebida de um apelido (quem usa decide se aceita)
  aoChamada?(call: MediaConnection, apelido: string): void;
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
        const convites = Array.isArray(d.convites)
          ? d.convites.filter((c) => RE_TOKEN.test(c.token) && c.expira > Date.now())
          : [];
        return { meuId: d.meuId, amigos: d.amigos, convites };
      }
    }
  } catch { /* dados corrompidos: gera novos */ }
  return { meuId: aleatorio(10), amigos: [], convites: [] };
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
  private diag = new Map<string, "procurando" | "offline" | "falhou" | "recebido">(); // por que um pedido ainda espera
  private recuperacoes = 0;
  private ultimoSinal = new Map<string, number>(); // última mensagem recebida de cada amigo conectado
  private falhas = new Map<string, number>();      // handshakes seguidos que falharam (amizade possivelmente desatualizada)
  private ultimaTentativa = new Map<string, number>(); // quando fomos atrás de cada amigo pela última vez
  private timer: number | undefined;
  private pulso: number | undefined;
  private reconexao: number | undefined;

  constructor(
    private nome: () => string,
    private ev: AmigosEventos,
    private criarPeer: (id: string) => Peer = (id) => new Peer(id),
    private store?: Memoria,
    private op: OpcoesAmigos = {},
  ) {
    if (typeof crypto === "undefined" || !crypto.subtle) {
      // WebCrypto só existe em https ou localhost
      this.estado = "indisponivel";
      this.dados = { meuId: "", amigos: [], convites: [] };
      return;
    }
    this.dados = carregar(store);
    this.salvar();

    // celular: ao voltar de outro app a conexão com o servidor costuma ter caído
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) this.acordar(); });
      window.addEventListener("online", () => this.acordar());
    }
  }

  get apelido(): string {
    return this.dados.meuId;
  }

  lista(): { amigo: Amigo; online: boolean; pendente: boolean; detalhe: string; desatualizado: boolean }[] {
    const textos = {
      procurando: "procurando...",
      offline: "ele está offline (precisa abrir o jogo)",
      falhou: "não consegui conectar, tentando de novo",
      recebido: "ele recebeu o pedido",
    };
    return this.dados.amigos.map((amigo) => ({
      amigo,
      online: this.online.get(amigo.id)?.open === true,
      pendente: amigo.secret === "",
      detalhe: amigo.secret === "" ? textos[this.diag.get(amigo.id) ?? "procurando"] : "",
      // o amigo está online mas não aceita o nosso segredo: um dos dois removeu o outro e refez a amizade
      desatualizado: amigo.secret !== "" && (this.falhas.get(amigo.id) ?? 0) >= FALHAS_PARA_REFAZER,
    }));
  }

  pedidos(): Pedido[] {
    return [...this.pedidosRecebidos].map(([id, p]) => ({ id, nome: p.nome }));
  }

  totalOnline(): number {
    return this.lista().filter((x) => x.online).length;
  }

  estaOnline(id: string): boolean {
    return this.online.get(id)?.open === true;
  }

  nomeDe(id: string): string {
    return this.dados.amigos.find((a) => a.id === id)?.nome ?? id;
  }

  // envia uma mensagem a um amigo online (já autenticado); false se ele não está conectado
  enviar(id: string, m: Record<string, unknown>): boolean {
    const c = this.online.get(id);
    if (!c || !c.open) return false;
    c.send(m);
    return true;
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
    let jaAbriu = false;

    // "open" também dispara de novo a cada reconexão: não pode acumular temporizadores
    peer.on("open", () => {
      jaAbriu = true;
      this.recuperacoes = 0;
      this.estado = "pronto";
      this.ev.aoMudar();
      this.procurar();
      window.clearInterval(this.timer);
      this.timer = window.setInterval(() => this.procurar(), this.op.repetirMs ?? REPETIR_MS);
      window.clearInterval(this.pulso);
      this.pulso = window.setInterval(() => this.batida(), this.op.batidaMs ?? BATIDA_MS);
    });
    peer.on("connection", (conn) => this.receber(conn));
    peer.on("call", (call) => this.ev.aoChamada?.(call, apelidoDePeerId(call.peer)));
    peer.on("disconnected", () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        // amigo offline: esperado; guarda o motivo para mostrar ao lado do pedido
        const m = /cscaps-u-([a-z0-9]+)/.exec(err.message ?? "");
        if (m) { this.diag.set(m[1], "offline"); this.ev.aoMudar(); }
        return;
      }
      if (err.type === "unavailable-id") {
        // quase sempre é o nosso próprio registro antigo (app fechado de repente, celular que dormiu): o servidor
        // demora a esquecê-lo. Tenta de novo; só desiste se persistir (outra pessoa ou outra aba usando o apelido)
        this.recriar();
        return;
      }
      if (!jaAbriu) {
        this.parar();
        this.estado = "erro";
        this.ev.aoMudar();
        this.reconexao = window.setTimeout(() => { this.estado = "conectando"; this.iniciar(); }, 10000);
      }
    });
  }

  // refaz a conexão com o servidor depois de uma queda
  private recriar(): void {
    this.parar();
    if (this.recuperacoes >= (this.op.maxRecuperacoes ?? MAX_RECUPERACOES)) {
      this.estado = "ocupado";
      this.ev.aoMudar();
      return;
    }
    this.recuperacoes++;
    this.estado = "conectando";
    this.ev.aoMudar();
    this.reconexao = window.setTimeout(() => this.iniciar(), this.op.recriarMs ?? RECRIAR_MS);
  }

  // chamado ao voltar para a aba ou quando a rede volta
  private acordar(): void {
    if (this.estado === "indisponivel") return;
    if (!this.peer) {
      if (this.estado === "erro" || this.estado === "ocupado") {
        this.recuperacoes = 0;
        window.clearTimeout(this.reconexao);
        this.iniciar();
      }
      return;
    }
    if (this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
    this.batida(); // confere agora quem ainda responde (a conexão pode ter morrido enquanto o app dormia)
    window.setTimeout(() => this.procurar(), 1500);
  }

  // sinal de vida: conexões de dados podem morrer sem avisar (celular dormiu, perdeu o sinal). Quem não manda
  // nada por um tempo é tirado de "online", senão ele aparece online e ninguém recebe os convites
  private batida(): void {
    const agora = Date.now();
    const limite = this.op.limiteSinalMs ?? LIMITE_SINAL_MS;
    let mudou = false;
    for (const [id, conn] of this.online) {
      if (!conn.open || agora - (this.ultimoSinal.get(id) ?? 0) > limite) {
        this.online.delete(id);
        this.ultimoSinal.delete(id);
        try { conn.close(); } catch { /* ignore */ }
        mudou = true;
        continue;
      }
      try { conn.send({ t: "ping" }); } catch { /* ignore */ }
    }
    if (mudou) this.ev.aoMudar();
  }

  parar(): void {
    window.clearInterval(this.timer);
    window.clearInterval(this.pulso);
    window.clearTimeout(this.reconexao);
    this.ultimoSinal.clear();
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
    this.dados = { meuId: novo, amigos: [], convites: [] };
    this.salvar();
    this.estado = "conectando";
    this.iniciar();
    return null;
  }

  // ---- Gerenciar amigos ----

  // gera um código de uso único para um link de convite e devolve "apelido.codigo"
  criarConvite(): string {
    if (this.estado === "indisponivel") return "";
    const token = aleatorio(16);
    this.dados.convites = [...this.dados.convites.filter((c) => c.expira > Date.now()), { token, expira: Date.now() + VALIDADE_LINK_MS }]
      .slice(-MAX_LINKS);
    this.salvar();
    return `${this.dados.meuId}.${token}`;
  }

  // gasta o código de um link (uso único); false se não existe, já foi usado ou expirou
  private consumirToken(token: string): boolean {
    const i = this.dados.convites.findIndex((c) => c.token === token && c.expira > Date.now());
    if (i < 0) return false;
    this.dados.convites.splice(i, 1);
    this.salvar();
    return true;
  }

  // envia um pedido de amizade (com o código do link, se veio de um); retorna erro, ou null se deu certo
  adicionar(texto: string, token?: string): string | null {
    if (this.estado === "indisponivel") return "Amigos exige https ou localhost.";
    const id = apelidoValido(texto);
    if (!id) return `Digite o apelido do amigo (${APELIDO_MIN} a ${APELIDO_MAX} letras ou números).`;
    if (id === this.dados.meuId) return "Esse é o seu próprio apelido.";
    const existente = this.dados.amigos.find((a) => a.id === id);
    if (existente) {
      return existente.secret === ""
        ? `Você já enviou um pedido para ${id}. Aguarde ele aceitar.`
        : `${existente.nome} já é seu amigo.`;
    }
    const amigo: Amigo = { id, nome: id, secret: "", confirmado: false };
    if (token && RE_TOKEN.test(token)) amigo.token = token;
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
    // avisa o amigo, se estiver online, para ele não ficar com uma amizade que já não existe
    if (c?.open) {
      try { c.send({ t: "removido" }); } catch { /* ignore */ }
      window.setTimeout(() => { try { c.close(); } catch { /* ignore */ } }, 400);
    } else {
      try { c?.close(); } catch { /* ignore */ }
    }
    this.ev.aoMudar();
  }

  // amizade desatualizada (um dos dois removeu o outro): volta ao estado de pedido e pede de novo.
  // O outro lado precisa aceitar, como em qualquer pedido, então ninguém consegue se passar por amigo por aqui
  refazer(id: string): void {
    const a = this.dados.amigos.find((x) => x.id === id);
    if (!a) return;
    this.fecharOnline(id);
    a.secret = "";
    a.confirmado = false;
    delete a.token;
    this.falhas.delete(id);
    this.diag.delete(id);
    this.salvar();
    this.ev.aoMudar();
    this.pedirA(a);
  }

  aceitar(id: string): void {
    const p = this.pedidosRecebidos.get(id);
    if (!p) return;
    this.pedidosRecebidos.delete(id);
    this.aceitarAgora(id, p.nome, p.conn);
  }

  private aceitarAgora(id: string, nome: string, conn: DataConnection): void {
    this.fecharOnline(id); // se já era amigo, o segredo antigo deixa de valer
    const segredo = aleatorio(20);
    this.guardarAmigo(id, nome, segredo);
    conn.send({ t: "aceito", s: segredo, nome: limparNome(this.nome()) });
    window.setTimeout(() => { try { conn.close(); } catch { /* ignore */ } }, 1000);
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

  // inicia uma chamada de voz com um amigo (usa a conexão atual com o servidor)
  ligarVoz(apelido: string, stream: MediaStream): MediaConnection | null {
    if (!this.peer || this.peer.destroyed || this.peer.disconnected || this.estado !== "pronto") return null;
    return this.peer.call(PREFIXO + apelido, stream);
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
      delete existente.token;
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
    if (!this.peer) return;
    if (this.peer.disconnected && !this.peer.destroyed) { this.peer.reconnect(); return; }
    if (this.estado !== "pronto") return;
    for (const a of this.dados.amigos) {
      if (this.online.get(a.id)?.open || this.tentando.has(a.id)) continue;
      if (a.secret === "") { this.pedirA(a); continue; }
      // evita as duas pontas ligarem ao mesmo tempo: o menor ID inicia, salvo se ainda não foi confirmado.
      // O outro lado também tenta, bem mais devagar: sem isso ele nunca descobriria que o amigo o removeu
      const devagar = Date.now() - (this.ultimaTentativa.get(a.id) ?? 0) > 3 * (this.op.repetirMs ?? REPETIR_MS);
      if (!a.confirmado || this.dados.meuId < a.id || devagar) this.conectarA(a);
    }
  }

  // ---- Pedido de amizade: quem envia ----

  private pedirA(amigo: Amigo): void {
    if (!this.peer || this.peer.disconnected || this.estado !== "pronto" || this.tentando.has(amigo.id)) return;
    this.tentando.add(amigo.id);
    this.diag.set(amigo.id, "procurando");

    const conn = this.peer.connect(PREFIXO + amigo.id, { reliable: true });
    let aguardando = false;
    const encerrar = () => { window.clearTimeout(limite); this.tentando.delete(amigo.id); };
    // conexão que nunca abriu (amigo offline) não emite "close": limpa a tentativa aqui mesmo
    const limite = window.setTimeout(() => {
      if (aguardando) return;
      // se o servidor já disse que ele está offline, mantém esse motivo
      if (this.diag.get(amigo.id) === "procurando") this.diag.set(amigo.id, "falhou");
      encerrar();
      try { conn.close(); } catch { /* ignore */ }
      this.ev.aoMudar();
    }, TIMEOUT_MS);

    conn.on("open", () => conn.send({ t: "pedido", nome: limparNome(this.nome()), token: amigo.token }));
    conn.on("close", encerrar);
    conn.on("error", encerrar);

    conn.on("data", (dado) => {
      const m = dado as { t?: string; s?: unknown; nome?: unknown };
      const atual = this.dados.amigos.find((a) => a.id === amigo.id);
      if (!atual) { try { conn.close(); } catch { /* ignore */ } return; }

      if (m.t === "aguardando") {
        // o outro lado está online e vai decidir: não precisa insistir
        aguardando = true;
        this.diag.set(amigo.id, "recebido");
        this.ev.aoMudar();
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

  private registrarPedido(id: string, nome: string, conn: DataConnection, token: string): void {
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

    // veio de um link que eu mesmo gerei: aceita sem precisar de aprovação
    if (token && RE_TOKEN.test(token) && this.consumirToken(token)) {
      this.aceitarAgora(id, nome, conn);
      this.ev.aoAviso(`${nome || id} entrou na sua lista de amigos pelo seu link.`);
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
    if (!this.peer || this.peer.disconnected || this.estado !== "pronto" || this.tentando.has(amigo.id) || !amigo.secret) return;
    this.tentando.add(amigo.id);
    this.ultimaTentativa.set(amigo.id, Date.now());

    const conn = this.peer.connect(PREFIXO + amigo.id, { reliable: true });
    const meuNonce = aleatorio(24);
    let autenticado = false;
    let abriu = false;
    let contada = false;

    // a conexão abriu (o amigo está online) mas o handshake não fechou: conta uma falha, no máximo uma por tentativa
    const falhar = () => {
      if (contada || autenticado || !abriu) return;
      contada = true;
      const n = (this.falhas.get(amigo.id) ?? 0) + 1;
      this.falhas.set(amigo.id, n);
      if (n === FALHAS_PARA_REFAZER) this.ev.aoMudar();
    };
    const encerrar = () => { window.clearTimeout(limite); this.tentando.delete(amigo.id); falhar(); };
    const limite = window.setTimeout(() => {
      if (autenticado) return;
      contada = true; // demorar não é recusar: só "fechou na cara" ou "segredo não confere" contam como falha
      encerrar();
      try { conn.close(); } catch { /* ignore */ }
    }, this.op.timeoutMs ?? TIMEOUT_MS);

    conn.on("open", () => {
      abriu = true;
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
      if (esperado !== m.mac) { falhar(); conn.close(); return; }
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
      const m = dado as { t?: string; id?: unknown; n?: unknown; mac?: unknown; nome?: unknown; token?: unknown };
      if (autenticado) { this.tratar(idRemoto, m); return; }
      if (pedido) return;

      if (m.t === "pedido" && !idRemoto) {
        if (!RE_APELIDO.test(idConexao) || idConexao === this.dados.meuId) { conn.close(); return; }
        pedido = true;
        window.clearTimeout(limite);
        this.registrarPedido(idConexao, limparNome(m.nome), conn, typeof m.token === "string" ? m.token : "");
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

    // já existe uma conexão com esse amigo: só a mantém se estiver mesmo viva (recebeu sinal há pouco).
    // Uma conexão morta que ainda consta como aberta não pode impedir o amigo de voltar
    const atual = this.online.get(id);
    if (atual && atual !== conn) {
      const viva = atual.open && Date.now() - (this.ultimoSinal.get(id) ?? 0) < (this.op.limiteSinalMs ?? LIMITE_SINAL_MS) / 2;
      if (viva) { conn.close(); return; }
      this.online.delete(id);
      try { atual.close(); } catch { /* ignore */ }
    }
    this.online.set(id, conn);
    this.ultimoSinal.set(id, Date.now());
    this.falhas.delete(id);
    conn.on("close", () => {
      if (this.online.get(id) === conn) { this.online.delete(id); this.ultimoSinal.delete(id); this.ev.aoMudar(); }
    });
    this.ev.aoMudar();
  }

  private tratar(id: string, m: { t?: string; sala?: unknown; [k: string]: unknown }): void {
    const amigo = this.dados.amigos.find((a) => a.id === id);
    if (!amigo) return;
    this.ultimoSinal.set(id, Date.now());
    if (m.t === "ping") return;
    if (m.t === "removido") {
      // o amigo nos tirou da lista dele: a amizade deixa de valer dos dois lados e fica à espera de uma decisão nossa
      this.falhas.set(id, FALHAS_PARA_REFAZER);
      this.fecharOnline(id);
      this.ev.aoAviso(`${amigo.nome} removeu você da lista de amigos.`);
      this.ev.aoMudar();
      return;
    }
    if (m.t === "convite" && typeof m.sala === "string") {
      const sala = normalizarCodigo(m.sala);
      if (sala) this.ev.aoConvite(amigo, sala);
    } else if (typeof m.t === "string" && m.t.startsWith("g-")) {
      this.ev.aoGrupo?.(amigo, m);
    }
  }
}
