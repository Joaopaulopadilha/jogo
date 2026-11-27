// A partida, do lado de quem manda (o anfitrião, ou o próprio aparelho no modo local e contra o computador).
// Não sabe se o outro jogador está longe: tudo que sai vai por `enviar(uid, mensagem)`.

import { escolherJogada, type Nivel } from "./bot.ts";
import { jogar, novoEstado, type Estado, type Jogador } from "./regras.ts";

export type Modo = "local" | "bot" | "online";
export type Msg = { t: string; [k: string]: unknown };

export type Vista = {
  t: "estado";
  cel: string; // "012..." uma letra por casa
  vez: Jogador;
  fim: boolean;
  vencedor: 0 | Jogador;
  linha: number[] | null;
  jogadas: number;
  placar: [number, number];
  nomes: [string, string];
  meus: number[]; // quais jogadores (1 = X, 2 = O) este aparelho controla
  modo: Modo;
  aguardando: boolean; // online: ainda falta o adversário entrar
  off: [boolean, boolean]; // online: jogador desconectado
};

export class Jogo {
  e: Estado;
  placar: [number, number] = [0, 0];
  readonly seats: (string | null)[]; // uid de quem joga como X e como O (null = computador ou lugar livre)
  readonly nomes: [string, string];
  private readonly conectado: [boolean, boolean] = [false, false];
  private comeca: Jogador = 1;
  private acaoEm = 0;

  constructor(
    readonly modo: Modo,
    private readonly enviar: (uid: string, m: Msg) => void,
    readonly hostUid: string,
    nomeHost: string,
    readonly nivel: Nivel = "normal",
    private readonly rnd: () => number = Math.random,
  ) {
    this.e = novoEstado(1);
    if (modo === "local") { this.seats = [hostUid, hostUid]; this.nomes = [nomeHost, "Jogador 2"]; }
    else if (modo === "bot") { this.seats = [hostUid, null]; this.nomes = [nomeHost, "Computador"]; }
    else { this.seats = [null, null]; this.nomes = [nomeHost, "Aguardando..."]; }
  }

  private get pronto(): boolean {
    return this.modo !== "online" || (this.seats[0] !== null && this.seats[1] !== null);
  }

  // entra na partida ou volta depois de cair. Devolve false se não houver lugar.
  entrar(uid: string, nome: string, agora = Date.now()): boolean {
    nome = nome.trim().slice(0, 16) || "Jogador";
    const meus = this.seats.map((u, k) => (u === uid ? k : -1)).filter((k) => k >= 0);
    if (meus.length > 0) {
      for (const k of meus) this.conectado[k] = true;
      if (this.modo !== "local") this.nomes[meus[0]] = nome;
      else this.nomes[0] = nome;
    } else if (this.modo === "online" && this.seats[0] === null) {
      this.seats[0] = uid;
      this.nomes[0] = nome;
      this.conectado[0] = true;
    } else if (this.modo === "online" && this.seats[1] === null) {
      this.seats[1] = uid;
      this.nomes[1] = nome;
      this.conectado[1] = true;
      this.e = novoEstado(this.comeca); // o adversário chegou: começa valendo
    } else {
      this.enviar(uid, { t: "cheia", motivo: "A sala já tem dois jogadores." });
      return false;
    }
    if (this.modo === "bot" && this.e.vez === 2) this.acaoEm = agora + 600;
    this.transmitir();
    return true;
  }

  sair(uid: string): void {
    this.seats.forEach((u, k) => { if (u === uid) this.conectado[k as 0 | 1] = false; });
    this.transmitir();
  }

  receber(uid: string, m: Msg, agora = Date.now()): void {
    if (!this.pronto) return;
    if (m.t === "jogar") {
      if (this.seats[this.e.vez - 1] !== uid) return; // fora da vez ou não é seu
      if (!jogar(this.e, Number(m.i), this.e.vez)) return;
      this.aposJogada(agora);
    } else if (m.t === "revanche") {
      if (!this.e.fim || !this.seats.includes(uid)) return;
      this.comeca = this.comeca === 1 ? 2 : 1; // quem começa alterna
      this.e = novoEstado(this.comeca);
      if (this.modo === "bot" && this.e.vez === 2) this.acaoEm = agora + 900;
      this.transmitir();
    }
  }

  private aposJogada(agora: number): void {
    if (this.e.fim && this.e.vencedor) this.placar[this.e.vencedor - 1]++;
    this.acaoEm = agora + 700 + this.rnd() * 500; // o computador "pensa" um pouco (e dá tempo da peça cair)
    this.transmitir();
  }

  // chamada várias vezes por segundo: o computador joga quando é a vez dele
  tick(agora = Date.now()): boolean {
    if (this.modo !== "bot" || this.e.fim || this.seats[this.e.vez - 1] !== null || agora < this.acaoEm) return false;
    const i = escolherJogada(this.e, this.e.vez, this.nivel, this.rnd);
    jogar(this.e, i, this.e.vez);
    this.aposJogada(agora);
    return true;
  }

  vistaPara(uid: string): Vista {
    const e = this.e;
    return {
      t: "estado",
      cel: e.cel.join(""),
      vez: e.vez,
      fim: e.fim,
      vencedor: e.vencedor,
      linha: e.linha,
      jogadas: e.jogadas,
      placar: this.placar,
      nomes: this.nomes,
      meus: this.seats.map((u, k) => (u === uid ? k + 1 : 0)).filter((k) => k > 0),
      modo: this.modo,
      aguardando: !this.pronto,
      off: [this.seats[0] !== null && !this.conectado[0], this.seats[1] !== null && !this.conectado[1]],
    };
  }

  transmitir(): void {
    const vistos = new Set<string>();
    this.seats.forEach((u, k) => {
      if (u && this.conectado[k] && !vistos.has(u)) {
        vistos.add(u);
        this.enviar(u, this.vistaPara(u));
      }
    });
  }
}
