// A mesa do anfitrião: sala de espera, assentos, bots e a partida. Não sabe se o jogador está no mesmo aparelho
// ou longe: tudo que sai vai pela função `enviar(uid, mensagem)`, que a tela liga na rede (ou direto na tela).

import { escolherCarta, jogarOnze, querAumentar, responderPedido } from "./bot.ts";
import {
  avancar, decidirOnze, jogar, novaPartida, pedirAumento, proximaMao, responder, timeDe, vistaPara,
  type Partida, type Resposta, type Time,
} from "./regras.ts";

export type Msg = { t: string; [k: string]: unknown };

export interface Jogador {
  uid: string;
  nome: string;
  conectado: boolean;
  desde: number; // desde quando está desconectado
}

interface Assento { uid: string | null } // null = bot

const NOMES_BOT = ["Seu Zé", "Dona Maria", "Tião", "Chico"];
const TOLERANCIA_MS = 12000; // quem some por mais que isso é substituído por um bot até voltar
export const MAX_JOGADORES = 4;

export class Mesa {
  fase: "sala" | "jogo" = "sala";
  n: 2 | 4 = 4;
  readonly jogadores: Jogador[] = [];
  p: Partida | null = null;
  private assentos: Assento[] = [];
  private acaoEm = 0;
  private rnd: () => number;

  constructor(private readonly enviar: (uid: string, m: Msg) => void, readonly hostUid: string, rnd: () => number = Math.random) {
    this.rnd = rnd;
  }

  // ---------------- sala ----------------

  // entra na sala ou volta depois de cair. Devolve false se não couber.
  entrar(uid: string, nome: string, agora = Date.now()): boolean {
    nome = nome.trim().slice(0, 16) || "Jogador";
    const j = this.jogadores.find((x) => x.uid === uid);
    if (j) {
      j.conectado = true;
      j.nome = nome;
      if (this.p) this.p.nomes[this.assentoDe(uid)] = nome;
    } else {
      if (this.fase !== "sala" || this.jogadores.length >= MAX_JOGADORES) {
        this.enviar(uid, { t: "cheia", motivo: this.fase === "sala" ? "A sala está cheia." : "A partida já começou." });
        return false;
      }
      this.jogadores.push({ uid, nome, conectado: true, desde: agora });
    }
    this.transmitir();
    return true;
  }

  sair(uid: string, agora = Date.now()): void {
    const j = this.jogadores.find((x) => x.uid === uid);
    if (!j) return;
    if (this.fase === "sala") {
      this.jogadores.splice(this.jogadores.indexOf(j), 1);
    } else {
      j.conectado = false;
      j.desde = agora;
    }
    this.transmitir();
  }

  iniciar(n: 2 | 4, agora = Date.now()): boolean {
    if (this.fase !== "sala") return false;
    if (n !== 2 && n !== 4) return false;
    const humanos = this.jogadores.filter((j) => j.conectado);
    if (humanos.length === 0 || humanos.length > n) return false;
    this.n = n;
    this.assentos = [];
    for (let s = 0; s < n; s++) this.assentos.push({ uid: humanos[s]?.uid ?? null });
    // quem não é humano vira bot com nome
    let b = 0;
    const nomes = this.assentos.map((a) => (a.uid ? this.jogadores.find((j) => j.uid === a.uid)!.nome : NOMES_BOT[b++ % NOMES_BOT.length]));
    // jogadores que não ganharam assento (não deveria acontecer) saem
    for (const j of [...this.jogadores]) if (!this.assentos.some((a) => a.uid === j.uid)) this.jogadores.splice(this.jogadores.indexOf(j), 1);
    this.p = novaPartida(n, nomes, this.rnd);
    this.fase = "jogo";
    this.acaoEm = agora + 1200;
    this.transmitir();
    return true;
  }

  // volta para a sala de espera (depois do fim da partida)
  novaSala(): void {
    if (this.fase !== "jogo") return;
    this.fase = "sala";
    this.p = null;
    this.assentos = [];
    for (const j of [...this.jogadores]) if (!j.conectado) this.jogadores.splice(this.jogadores.indexOf(j), 1);
    this.transmitir();
  }

  // ---------------- mensagens dos jogadores ----------------

  receber(uid: string, m: Msg, agora = Date.now()): void {
    if (m.t === "iniciar") {
      if (uid === this.hostUid) this.iniciar(Number(m.n) === 2 ? 2 : 4, agora);
      return;
    }
    if (m.t === "novo") {
      if (uid === this.hostUid) this.novaSala();
      return;
    }
    const p = this.p;
    if (this.fase !== "jogo" || !p) return;
    const seat = this.assentoDe(uid);
    if (seat < 0) return;
    let mudou = false;
    if (m.t === "jogar") mudou = jogar(p, seat, Number(m.i));
    else if (m.t === "truco") mudou = pedirAumento(p, seat);
    else if (m.t === "resp") {
      const a = m.a as Resposta;
      if (a === "aceitar" || a === "correr" || a === "aumentar") mudou = responder(p, seat, a);
    } else if (m.t === "onze") mudou = decidirOnze(p, timeDe(seat), !!m.j);
    if (mudou) {
      this.acaoEm = Math.max(this.acaoEm, agora + 700);
      this.transmitir();
    }
  }

  // ---------------- bots e andamento ----------------

  // quem controla o assento agora: humano conectado (ou que acabou de cair) ou bot
  private humano(seat: number, agora: number): boolean {
    const uid = this.assentos[seat]?.uid;
    if (!uid) return false;
    const j = this.jogadores.find((x) => x.uid === uid);
    return !!j && (j.conectado || agora - j.desde < TOLERANCIA_MS);
  }

  private timeTemHumano(time: Time, agora: number): boolean {
    for (let s = 0; s < this.n; s++) if (timeDe(s) === time && this.humano(s, agora)) return true;
    return false;
  }

  private assentoDe(uid: string): number {
    return this.assentos.findIndex((a) => a.uid === uid);
  }

  // chamada várias vezes por segundo: faz no máximo uma ação automática por vez e respeita o ritmo
  tick(agora = Date.now()): boolean {
    const p = this.p;
    if (this.fase !== "jogo" || !p || agora < this.acaoEm) return false;
    const atraso = (min: number, max: number): number => agora + min + this.rnd() * (max - min);

    if (p.fase === "vazaFechada") {
      avancar(p);
      const fechou = (p.fase as string) !== "jogando"; // a mão acabou: mostra o resultado logo, sem esperar
      this.acaoEm = atraso(fechou ? 100 : 300, fechou ? 150 : 450);
      this.transmitir();
      return true;
    }
    if (p.fase === "fimMao") {
      proximaMao(p, this.rnd);
      this.acaoEm = atraso(900, 1200);
      this.transmitir();
      return true;
    }
    if (p.fase !== "jogando") return false;

    if (p.decisao11 !== null) {
      if (this.timeTemHumano(p.decisao11, agora)) return false;
      decidirOnze(p, p.decisao11, jogarOnze(p, p.decisao11));
      this.acaoEm = atraso(1200, 1800);
      this.transmitir();
      return true;
    }
    if (p.pedido) {
      const time = (1 - timeDe(p.pedido.de)) as Time;
      if (this.timeTemHumano(time, agora)) return false;
      let seat = 0;
      for (let s = 0; s < this.n; s++) if (timeDe(s) === time) { seat = s; break; }
      responder(p, seat, responderPedido(p, seat, this.rnd));
      this.acaoEm = atraso(1200, 2000);
      this.transmitir();
      return true;
    }
    if (this.humano(p.vez, agora)) return false;
    if (querAumentar(p, p.vez, this.rnd)) pedirAumento(p, p.vez);
    else jogar(p, p.vez, escolherCarta(p, p.vez, this.rnd));
    this.acaoEm = atraso(900, 1500);
    this.transmitir();
    return true;
  }

  // ---------------- saída ----------------

  transmitir(): void {
    if (this.fase === "sala") {
      for (const j of this.jogadores) {
        if (!j.conectado) continue;
        this.enviar(j.uid, {
          t: "sala",
          jogadores: this.jogadores.map((x) => ({ nome: x.nome, conectado: x.conectado, eu: x.uid === j.uid, host: x.uid === this.hostUid })),
          souHost: j.uid === this.hostUid,
        });
      }
      return;
    }
    const p = this.p;
    if (!p) return;
    const bots = this.assentos.map((a) => a.uid === null);
    for (let s = 0; s < this.assentos.length; s++) {
      const uid = this.assentos[s].uid;
      if (!uid) continue;
      const j = this.jogadores.find((x) => x.uid === uid);
      if (j && j.conectado) this.enviar(uid, { ...vistaPara(p, s, bots), souHost: uid === this.hostUid });
    }
  }
}
