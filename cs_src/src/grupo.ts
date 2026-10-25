// grupo.ts
// Grupo (party) de amigos no lobby: convite, entrada, modo, "pronto" e início da partida.
//
// O líder (quem criou o grupo) é a fonte da verdade: guarda a lista de membros e o modo, e transmite o estado
// aos outros. Os membros só pedem coisas ("estou pronto", "saí"). Tudo trafega pelo canal de amigos, que já é
// autenticado, e cada mensagem é validada contra quem pode mandá-la (ex.: só o líder muda o estado).

import type { Dificuldade } from "./bot";

export const MAX_GRUPO = 4;
const VALIDADE_CONVITE_MS = 60_000;
const ESPERA_ESTADO_MS = 8_000; // depois de aceitar, tempo para o líder confirmar a entrada

export type ModoJogo = "cpu" | "grupo"; // cpu: mata-mata com CPUs; grupo: mata-mata só entre os amigos

export interface ConfigGrupo {
  modo: ModoJogo;
  cpus: number;
  dificuldade: Dificuldade;
}

export interface Membro {
  id: string;     // apelido de amigo
  nome: string;
  pronto: boolean;
}

export interface Transporte {
  meuId(): string;
  meuNome(): string;
  enviar(id: string, m: Record<string, unknown>): boolean;
  online(id: string): boolean;
  ocupado(): boolean; // em partida: não pode entrar em grupo agora
}

export interface InicioPartida {
  papel: "lider" | "membro";
  sala: string;
  humanos: number;
  config: ConfigGrupo;
}

export interface GrupoEventos {
  aoMudar(): void;
  aoConvite(deId: string, deNome: string): void;
  aoIniciar(inicio: InicioPartida): void;
  aoAviso(msg: string): void;
}

const MODOS: ModoJogo[] = ["cpu", "grupo"];
const DIFICULDADES: Dificuldade[] = ["facil", "normal", "dificil"];
const RE_APELIDO = /^[a-z0-9]{3,20}$/;
const RE_SALA = /^[a-z0-9]{3,12}$/;

const texto = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, 14) : "");

function gerarSala(): string {
  const alfabeto = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => alfabeto[x % alfabeto.length]).join("");
}

export class Grupo {
  lider: string;
  membros: Membro[];
  config: ConfigGrupo = { modo: "cpu", cpus: 3, dificuldade: "normal" };

  private convitesEnviados = new Map<string, number>(); // id -> expira
  private convitePendente: { id: string; nome: string; expira: number } | null = null;
  private aguardandoLider: { id: string; expira: number } | null = null;

  constructor(private t: Transporte, private ev: GrupoEventos) {
    this.lider = t.meuId();
    this.membros = [{ id: t.meuId(), nome: t.meuNome(), pronto: false }];
  }

  get souLider(): boolean {
    return this.lider === this.t.meuId();
  }

  get emGrupo(): boolean {
    return this.membros.length > 1;
  }

  get eu(): Membro {
    return this.membros.find((m) => m.id === this.t.meuId()) ?? this.membros[0];
  }

  get conviteRecebido(): { id: string; nome: string } | null {
    return this.convitePendente && this.convitePendente.expira > Date.now() ? this.convitePendente : null;
  }

  jaConvidado(id: string): boolean {
    return (this.convitesEnviados.get(id) ?? 0) > Date.now();
  }

  // por que o botão "pronto/jogar" não pode ser usado agora (ou null)
  motivoBloqueio(): string | null {
    if (this.config.modo === "grupo" && this.membros.length < 2) return "Chame um amigo para jogar este modo";
    return null;
  }

  // ---- ações do líder ----

  convidar(id: string): string | null {
    if (!this.souLider) return "Só o líder do grupo pode convidar.";
    if (this.membros.some((m) => m.id === id)) return "Essa pessoa já está no grupo.";
    if (this.membros.length >= MAX_GRUPO) return "O grupo está cheio.";
    if (!this.t.online(id)) return "Seu amigo está offline.";
    if (!this.t.enviar(id, { t: "g-convite", nome: this.t.meuNome() })) return "Não consegui falar com seu amigo.";
    this.convitesEnviados.set(id, Date.now() + VALIDADE_CONVITE_MS);
    this.ev.aoMudar();
    return null;
  }

  definirConfig(parcial: Partial<ConfigGrupo>): boolean {
    if (!this.souLider) return false;
    const novo: ConfigGrupo = { ...this.config, ...parcial };
    if (!MODOS.includes(novo.modo)) return false;
    if (!DIFICULDADES.includes(novo.dificuldade)) return false;
    if (parcial.modo === "cpu" && this.config.modo !== "cpu") novo.cpus = Math.max(1, MAX_GRUPO - this.membros.length);
    this.config = this.ajustar(novo);
    this.resetarProntos();
    this.transmitir();
    return true;
  }

  // ---- pronto / início ----

  alternarPronto(): void {
    const eu = this.eu;
    const novo = !eu.pronto;
    if (novo) {
      const motivo = this.motivoBloqueio();
      if (motivo) { this.ev.aoAviso(motivo); return; }
    }
    eu.pronto = novo;
    if (this.souLider) {
      this.transmitir();
      this.verificarInicio();
    } else {
      this.t.enviar(this.lider, { t: "g-pronto", pronto: novo });
      this.ev.aoMudar();
    }
  }

  private verificarInicio(): void {
    if (!this.souLider || !this.membros.every((m) => m.pronto) || this.motivoBloqueio()) return;
    const sala = gerarSala();
    const humanos = this.membros.length;
    const config = { ...this.config };
    this.resetarProntos();
    this.transmitir();
    // quem chama cria a sala e só então chama liberarSala(): os membros não tentam entrar antes dela existir
    this.ev.aoIniciar({ papel: "lider", sala, humanos, config });
  }

  // avisa os membros que a sala já está aberta e eles podem entrar
  liberarSala(sala: string): void {
    if (!this.souLider) return;
    for (const m of this.membros) {
      if (m.id !== this.t.meuId()) this.t.enviar(m.id, { t: "g-iniciar", sala });
    }
  }

  // vaga deste jogador no grupo (0 = líder)
  get minhaVaga(): number {
    return Math.max(0, this.membros.findIndex((m) => m.id === this.t.meuId()));
  }

  // ---- convites recebidos ----

  aceitarConvite(): void {
    const c = this.conviteRecebido;
    this.convitePendente = null;
    if (!c) { this.ev.aoMudar(); return; }
    this.aguardandoLider = { id: c.id, expira: Date.now() + ESPERA_ESTADO_MS };
    this.t.enviar(c.id, { t: "g-entrar", nome: this.t.meuNome() });
    this.ev.aoMudar();
  }

  recusarConvite(): void {
    const c = this.convitePendente;
    this.convitePendente = null;
    if (c) this.t.enviar(c.id, { t: "g-recusar", motivo: "recusou" });
    this.ev.aoMudar();
  }

  // ---- sair ----

  sair(): void {
    if (this.emGrupo) {
      if (this.souLider) {
        for (const m of this.membros) if (m.id !== this.t.meuId()) this.t.enviar(m.id, { t: "g-dissolver" });
      } else {
        this.t.enviar(this.lider, { t: "g-sair" });
      }
    }
    this.reiniciar();
  }

  reiniciar(): void {
    this.lider = this.t.meuId();
    this.membros = [{ id: this.t.meuId(), nome: this.t.meuNome(), pronto: false }];
    this.config = this.ajustar(this.config);
    this.convitesEnviados.clear();
    this.aguardandoLider = null;
    this.ev.aoMudar();
  }

  // ---- presença (chamar quando amigos entram/saem e periodicamente) ----

  sincronizar(): void {
    const agora = Date.now();
    let mudou = false;

    for (const [id, exp] of this.convitesEnviados) if (exp <= agora) { this.convitesEnviados.delete(id); mudou = true; }
    if (this.convitePendente && this.convitePendente.expira <= agora) { this.convitePendente = null; mudou = true; }
    if (this.aguardandoLider && this.aguardandoLider.expira <= agora) {
      this.aguardandoLider = null;
      this.ev.aoAviso("O líder não confirmou sua entrada no grupo.");
      mudou = true;
    }

    if (this.souLider) {
      const fora = this.membros.filter((m) => m.id !== this.t.meuId() && !this.t.online(m.id));
      if (fora.length) {
        this.membros = this.membros.filter((m) => !fora.includes(m));
        this.config = this.ajustar(this.config);
        this.resetarProntos();
        this.ev.aoAviso(`${fora.map((m) => m.nome).join(", ")} saiu do grupo.`);
        this.transmitir();
        return;
      }
    } else if (!this.t.online(this.lider)) {
      this.reiniciar();
      this.ev.aoAviso("Você saiu do grupo (o líder ficou offline).");
      return;
    }
    if (mudou) this.ev.aoMudar();
  }

  // ---- mensagens ----

  aoMensagem(deId: string, deNome: string, m: Record<string, unknown>): void {
    switch (m.t) {
      case "g-convite": return this.receberConvite(deId, deNome, m);
      case "g-recusar": return this.receberRecusa(deId, deNome, m);
      case "g-entrar": return this.receberEntrada(deId, deNome, m);
      case "g-estado": return this.receberEstado(deId, m);
      case "g-pronto": return this.receberPronto(deId, m);
      case "g-sair": return this.receberSaida(deId, deNome);
      case "g-dissolver":
        if (deId === this.lider && !this.souLider) {
          this.reiniciar();
          this.ev.aoAviso("O líder desfez o grupo.");
        }
        return;
      case "g-iniciar": return this.receberInicio(deId, m);
    }
  }

  private receberConvite(deId: string, deNome: string, m: Record<string, unknown>): void {
    if (!RE_APELIDO.test(deId)) return;
    if (this.t.ocupado() || this.emGrupo || this.aguardandoLider || this.conviteRecebido) {
      this.t.enviar(deId, { t: "g-recusar", motivo: "ocupado" });
      return;
    }
    const nome = texto(m.nome) || deNome;
    this.convitePendente = { id: deId, nome, expira: Date.now() + VALIDADE_CONVITE_MS };
    this.ev.aoConvite(deId, nome);
    this.ev.aoMudar();
  }

  private receberRecusa(deId: string, deNome: string, m: Record<string, unknown>): void {
    if (!this.convitesEnviados.delete(deId)) return;
    this.ev.aoAviso(m.motivo === "ocupado" ? `${deNome} está ocupado agora.` : `${deNome} recusou o convite.`);
    this.ev.aoMudar();
  }

  private receberEntrada(deId: string, deNome: string, m: Record<string, unknown>): void {
    if (!this.souLider) return;
    const exp = this.convitesEnviados.get(deId);
    if (!exp || exp <= Date.now()) return; // só entra quem foi convidado
    this.convitesEnviados.delete(deId);
    if (this.membros.length >= MAX_GRUPO) { this.t.enviar(deId, { t: "g-recusar", motivo: "cheio" }); return; }
    const nome = texto(m.nome) || deNome;
    this.membros.push({ id: deId, nome, pronto: false });
    this.config = this.ajustar(this.config);
    this.resetarProntos();
    this.ev.aoAviso(`${nome} entrou no grupo.`);
    this.transmitir();
  }

  private receberEstado(deId: string, m: Record<string, unknown>): void {
    const esperado = this.aguardandoLider?.id === deId || (deId === this.lider && !this.souLider);
    if (!esperado || m.lider !== deId || !Array.isArray(m.membros)) return;

    const membros: Membro[] = [];
    for (const x of m.membros as Record<string, unknown>[]) {
      if (!x || typeof x.id !== "string" || !RE_APELIDO.test(x.id) || membros.some((y) => y.id === x.id)) return;
      membros.push({ id: x.id, nome: texto(x.nome) || x.id, pronto: x.pronto === true });
    }
    if (membros.length < 1 || membros.length > MAX_GRUPO || membros[0].id !== deId) return;

    const c = m.config as Record<string, unknown> | undefined;
    if (!c || !MODOS.includes(c.modo as ModoJogo) || !DIFICULDADES.includes(c.dificuldade as Dificuldade) || typeof c.cpus !== "number") return;

    if (!membros.some((x) => x.id === this.t.meuId())) {
      // fui removido (ou o líder não me aceitou)
      if (this.souLider) return;
      this.reiniciar();
      return;
    }
    this.aguardandoLider = null;
    this.lider = deId;
    this.membros = membros;
    this.config = this.ajustar({ modo: c.modo as ModoJogo, cpus: c.cpus, dificuldade: c.dificuldade as Dificuldade });
    this.ev.aoMudar();
  }

  private receberPronto(deId: string, m: Record<string, unknown>): void {
    if (!this.souLider) return;
    const membro = this.membros.find((x) => x.id === deId);
    if (!membro) return;
    membro.pronto = m.pronto === true;
    this.transmitir();
    this.verificarInicio();
  }

  private receberSaida(deId: string, deNome: string): void {
    if (!this.souLider || !this.membros.some((m) => m.id === deId)) return;
    this.membros = this.membros.filter((m) => m.id !== deId);
    this.config = this.ajustar(this.config);
    this.resetarProntos();
    this.ev.aoAviso(`${deNome} saiu do grupo.`);
    this.transmitir();
  }

  private receberInicio(deId: string, m: Record<string, unknown>): void {
    if (deId !== this.lider || this.souLider || typeof m.sala !== "string" || !RE_SALA.test(m.sala)) return;
    this.ev.aoIniciar({ papel: "membro", sala: m.sala, humanos: this.membros.length, config: { ...this.config } });
  }

  // ---- internos ----

  // limita as CPUs às vagas livres (e garante ao menos uma no modo "cpu" quando há vaga)
  private ajustar(c: ConfigGrupo): ConfigGrupo {
    const vagas = Math.max(0, MAX_GRUPO - this.membros.length);
    if (c.modo === "grupo") return { ...c, cpus: 0 };
    const cpus = Math.max(vagas > 0 ? 1 : 0, Math.min(vagas, Math.round(c.cpus)));
    return { ...c, cpus };
  }

  private resetarProntos(): void {
    for (const m of this.membros) m.pronto = false;
  }

  private transmitir(): void {
    this.eu.nome = this.t.meuNome();
    const estado = {
      t: "g-estado",
      lider: this.lider,
      membros: this.membros.map((m) => ({ id: m.id, nome: m.nome, pronto: m.pronto })),
      config: { ...this.config },
    };
    for (const m of this.membros) if (m.id !== this.t.meuId()) this.t.enviar(m.id, estado);
    this.ev.aoMudar();
  }
}
