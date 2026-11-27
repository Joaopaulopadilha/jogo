// A mesa do anfitrião: sala de espera, assentos, bots e as rodadas. Não sabe se o jogador está no mesmo aparelho
// ou longe: tudo que sai vai pela função `enviar(uid, mensagem)`.

import { escolherDescarte, pegarDoLixo } from "./bot.ts";
import {
  bater, comecarRodada, comprar, descartar, novaPartida, podeBaterCom, responderOferta, vistaPara, type Partida,
} from "./regras.ts";

export type Msg = { t: string; [k: string]: unknown };

export interface Jogador {
  uid: string;
  nome: string;
  conectado: boolean;
  desde: number; // desde quando está desconectado
}

const NOMES_BOT = ["Seu Zé", "Dona Maria", "Tião", "Chica"];
const TOLERANCIA_MS = 20000; // quem some por mais que isso é substituído por um bot até voltar
export const MAX_JOGADORES = 4;

export class Mesa {
  fase: "sala" | "jogo" = "sala";
  readonly jogadores: Jogador[] = [];
  p: Partida | null = null;
  private assentos: (string | null)[] = []; // uid ou null (bot)
  private acaoEm = 0;
  private readonly ultimoChat = new Map<string, number>();

  constructor(private readonly enviar: (uid: string, m: Msg) => void, readonly hostUid: string, private readonly rnd: () => number = Math.random) {}

  // ---------------- sala ----------------

  entrar(uid: string, nome: string, agora = Date.now()): boolean {
    nome = nome.trim().slice(0, 16) || "Jogador";
    const j = this.jogadores.find((x) => x.uid === uid);
    if (j) {
      j.conectado = true;
      j.nome = nome;
      if (this.p) this.p.nomes[this.assentos.indexOf(uid)] = nome;
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
    if (this.fase === "sala") this.jogadores.splice(this.jogadores.indexOf(j), 1);
    else { j.conectado = false; j.desde = agora; }
    this.transmitir();
  }

  iniciar(n: number, agora = Date.now()): boolean {
    if (this.fase !== "sala" || !Number.isInteger(n) || n < 2 || n > MAX_JOGADORES) return false;
    const humanos = this.jogadores.filter((j) => j.conectado);
    if (humanos.length === 0 || humanos.length > n) return false;
    this.assentos = [];
    for (let s = 0; s < n; s++) this.assentos.push(humanos[s]?.uid ?? null);
    let b = 0;
    const nomes = this.assentos.map((u) => (u ? this.jogadores.find((j) => j.uid === u)!.nome : NOMES_BOT[b++ % NOMES_BOT.length]));
    for (const j of [...this.jogadores]) if (!this.assentos.includes(j.uid)) this.jogadores.splice(this.jogadores.indexOf(j), 1);
    this.p = novaPartida(n, nomes, this.rnd);
    this.fase = "jogo";
    this.acaoEm = agora + 1500;
    this.transmitir();
    return true;
  }

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
    if (m.t === "chat") {
      this.chat(uid, String(m.texto ?? ""), agora);
      return;
    }
    if (m.t === "iniciar") {
      if (uid === this.hostUid) this.iniciar(Number(m.n), agora);
      return;
    }
    if (m.t === "sala") {
      if (uid === this.hostUid) this.novaSala();
      return;
    }
    const p = this.p;
    if (this.fase !== "jogo" || !p) return;
    const seat = this.assentos.indexOf(uid);
    if (seat < 0) return;
    let mudou = false;
    if (m.t === "comprar") mudou = comprar(p, seat, m.de === "lixo" ? "lixo" : "monte", this.rnd);
    else if (m.t === "descartar") mudou = descartar(p, seat, Number(m.id));
    else if (m.t === "bater") mudou = p.fase === "oferta" ? responderOferta(p, seat, true) : bater(p, seat);
    else if (m.t === "passar") mudou = responderOferta(p, seat, false);
    else if (m.t === "proxima" && uid === this.hostUid && p.fase === "fim") { comecarRodada(p, this.rnd); mudou = true; }
    if (mudou) {
      this.acaoEm = Math.max(this.acaoEm, agora + 900);
      this.transmitir();
    }
  }

  // chat geral: o que alguém da sala escreve chega a todos (na sala de espera e durante a partida)
  private chat(uid: string, texto: string, agora: number): void {
    const autor = this.jogadores.find((j) => j.uid === uid);
    if (!autor) return;
    texto = texto.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
    if (!texto) return;
    if (agora - (this.ultimoChat.get(uid) ?? -Infinity) < 700) return; // evita spam
    this.ultimoChat.set(uid, agora);
    for (const j of this.jogadores) if (j.conectado) this.enviar(j.uid, { t: "chat", nome: autor.nome, texto, meu: j.uid === uid });
  }

  // ---------------- bots e andamento ----------------

  private humano(seat: number, agora: number): boolean {
    const uid = this.assentos[seat];
    if (!uid) return false;
    const j = this.jogadores.find((x) => x.uid === uid);
    return !!j && (j.conectado || agora - j.desde < TOLERANCIA_MS);
  }

  // chamada várias vezes por segundo: no máximo uma ação automática por vez, com ritmo de gente
  tick(agora = Date.now()): boolean {
    const p = this.p;
    if (this.fase !== "jogo" || !p || p.fase === "fim" || agora < this.acaoEm) return false;
    const atraso = (min: number, max: number): number => agora + min + this.rnd() * (max - min);

    if (p.fase === "oferta") {
      const s = p.ofertas[0];
      if (this.humano(s, agora)) return false;
      responderOferta(p, s, true); // bot nunca deixa passar a vitória
      this.acaoEm = atraso(900, 1400);
    } else {
      const s = p.vez;
      if (this.humano(s, agora)) return false;
      if (podeBaterCom(p.maos[s])) bater(p, s);
      else if (p.fase === "comprar") comprar(p, s, pegarDoLixo(p, s) ? "lixo" : "monte", this.rnd);
      else descartar(p, s, escolherDescarte(p, s, this.rnd));
      this.acaoEm = atraso(900, 1500);
    }
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
        });
      }
      return;
    }
    const p = this.p;
    if (!p) return;
    const bots = this.assentos.map((u) => u === null);
    this.assentos.forEach((uid, s) => {
      if (!uid) return;
      const j = this.jogadores.find((x) => x.uid === uid);
      if (j?.conectado) this.enviar(uid, { ...vistaPara(p, s, bots) });
    });
  }
}
