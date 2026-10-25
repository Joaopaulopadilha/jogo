// voz.ts
// Chat de voz por WebRTC (chamadas de áudio do PeerJS). Malha completa: cada par de jogadores tem uma chamada.
//
// - Todos OUVEM desde o início; o microfone só abre quando o jogador liga (e a permissão só é pedida nesse momento).
// - Cada chamada sempre envia uma trilha: um silêncio gerado aqui ou o microfone. Ligar/desligar o microfone só troca
//   a trilha (replaceTrack), sem renegociar nada. Desligar de verdade solta o microfone (some o indicador do navegador).
// - Silenciar alguém é local: só muda o que EU ouço.
//
// O módulo não sabe quem são as pessoas: quem usa dá a cada chamada um "contexto" (grupo do lobby ou partida) e
// resolve os nomes. Chamadas de um contexto podem ser fechadas todas de uma vez (ex.: ao começar a partida).

import type { MediaConnection } from "peerjs";

export type ContextoVoz = "grupo" | "partida";

interface Ligacao {
  peerId: string;
  contexto: ContextoVoz;
  call: MediaConnection;
  audio: HTMLAudioElement | null;
  fonte: MediaStreamAudioSourceNode | null;
  analisador: AnalyserNode | null;
  falandoAte: number;
  conectada: boolean;
}

export interface Participante {
  peerId: string;
  contexto: ContextoVoz;
  silenciado: boolean;
  falando: boolean;
  conectado: boolean;
}

export interface VozEventos {
  aoMudar(): void;
}

const LIMIAR_FALA = 0.03;   // energia (RMS) a partir da qual contamos como "falando"
const PERSISTENCIA_MS = 350; // continua marcado como falando por um instante, para o indicador não piscar

function rms(an: AnalyserNode, buf: Uint8Array<ArrayBuffer>): number {
  an.getByteTimeDomainData(buf);
  let soma = 0;
  for (const v of buf) { const x = (v - 128) / 128; soma += x * x; }
  return Math.sqrt(soma / buf.length);
}

export class Voz {
  microfone = false; // microfone aberto (enviando a voz)
  private abrindo = false;
  volume = 1;        // volume do que ouço (0 a 1)

  private ac: AudioContext | null = null;
  private saida = new MediaStream();            // sempre com uma trilha de áudio: silêncio ou microfone
  private silencio: MediaStreamTrack | null = null;
  private mic: MediaStream | null = null;
  private analisadorMic: AnalyserNode | null = null;
  private fonteMic: MediaStreamAudioSourceNode | null = null;
  private meuFalandoAte = 0;
  private ligacoes = new Map<string, Ligacao>();
  private silenciados = new Set<string>();
  private buffer = new Uint8Array(new ArrayBuffer(128));

  constructor(private ev: VozEventos) {}

  // precisa de https (ou localhost), de microfone acessível pelo navegador e de WebAudio
  static suportado(): boolean {
    return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
  }

  private contextoAudio(): AudioContext {
    this.ac ??= new AudioContext();
    return this.ac;
  }

  // o navegador só deixa o áudio tocar depois de um gesto do usuário: chamar a cada toque/clique
  retomar(): void {
    if (this.ac && this.ac.state === "suspended") void this.ac.resume();
    // áudio que o navegador bloqueou por falta de gesto volta a tocar agora
    for (const l of this.ligacoes.values()) if (l.audio?.paused) void l.audio.play().catch(() => {});
  }

  // trilha enviada em toda chamada (começa em silêncio)
  get fluxo(): MediaStream {
    if (!this.silencio) {
      const dest = this.contextoAudio().createMediaStreamDestination();
      this.silencio = dest.stream.getAudioTracks()[0];
      this.saida.addTrack(this.silencio);
    }
    return this.saida;
  }

  // ---- microfone ----

  // liga ou desliga o microfone; devolve uma mensagem de erro (ou null se deu certo)
  async alternarMicrofone(): Promise<string | null> {
    if (this.abrindo) return null; // já está pedindo o microfone (ex.: ligação automática e clique ao mesmo tempo)
    if (this.microfone) { this.desligarMicrofone(); return null; }
    if (!Voz.suportado()) return "A voz precisa de https e de um navegador com acesso ao microfone.";
    this.fluxo; // garante a trilha de silêncio antes de trocar
    this.retomar();
    this.abrindo = true;
    try {
      const m = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const trilha = m.getAudioTracks()[0];
      trilha.onended = () => this.desligarMicrofone(); // ex.: o aparelho foi desconectado
      this.mic = m;
      this.trocarTrilha(trilha);
      const ac = this.contextoAudio();
      this.fonteMic = ac.createMediaStreamSource(m);
      this.analisadorMic = ac.createAnalyser();
      this.analisadorMic.fftSize = 256;
      this.fonteMic.connect(this.analisadorMic);
      this.microfone = true;
      this.ev.aoMudar();
      return null;
    } catch (e) {
      const nome = e instanceof DOMException ? e.name : "";
      if (nome === "NotAllowedError" || nome === "SecurityError") return "O navegador bloqueou o microfone. Libere a permissão nas configurações do site e tente de novo.";
      if (nome === "NotFoundError" || nome === "OverconstrainedError") return "Nenhum microfone foi encontrado neste aparelho.";
      if (nome === "NotReadableError") return "O microfone está em uso por outro programa.";
      return "Não consegui abrir o microfone.";
    } finally {
      this.abrindo = false;
    }
  }

  private desligarMicrofone(): void {
    this.mic?.getTracks().forEach((t) => t.stop()); // solta o microfone de verdade
    this.fonteMic?.disconnect();
    this.fonteMic = null;
    this.analisadorMic = null;
    this.mic = null;
    if (this.silencio) this.trocarTrilha(this.silencio);
    const estava = this.microfone;
    this.microfone = false;
    if (estava) this.ev.aoMudar();
  }

  // a trilha que vai nas chamadas novas e nas que já existem
  private trocarTrilha(nova: MediaStreamTrack): void {
    for (const antiga of this.saida.getAudioTracks()) if (antiga !== nova) this.saida.removeTrack(antiga);
    if (!this.saida.getAudioTracks().includes(nova)) this.saida.addTrack(nova);
    for (const l of this.ligacoes.values()) {
      const emissor = l.call.peerConnection?.getSenders().find((s) => s.track?.kind === "audio");
      void emissor?.replaceTrack(nova).catch(() => {});
    }
  }

  // ---- chamadas ----

  // atende uma chamada que chegou
  atender(call: MediaConnection, contexto: ContextoVoz): void {
    call.answer(this.fluxo);
    this.registrar(call, contexto);
  }

  // registra uma chamada que NÓS iniciamos (peer.call(..., voz.fluxo))
  chamou(call: MediaConnection, contexto: ContextoVoz): void {
    this.registrar(call, contexto);
  }

  temLigacao(peerId: string): boolean {
    return this.ligacoes.has(peerId);
  }

  private registrar(call: MediaConnection, contexto: ContextoVoz): void {
    const peerId = call.peer;
    const antiga = this.ligacoes.get(peerId);
    if (antiga && antiga.call !== call) this.remover(antiga, true);

    const l: Ligacao = { peerId, contexto, call, audio: null, fonte: null, analisador: null, falandoAte: 0, conectada: false };
    this.ligacoes.set(peerId, l);
    call.on("stream", (stream) => this.aoReceberAudio(l, stream));
    call.on("close", () => this.remover(l, false));
    call.on("error", () => this.remover(l, false));
    // chamada que nunca conecta (o outro lado não atendeu): descarta para quem usa poder tentar de novo
    window.setTimeout(() => { if (!l.conectada && this.ligacoes.get(peerId) === l) this.remover(l, true); }, 7000);
    this.ev.aoMudar();
  }

  private aoReceberAudio(l: Ligacao, stream: MediaStream): void {
    if (l.audio) return; // o PeerJS pode avisar mais de uma vez
    const el = document.createElement("audio");
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    el.srcObject = stream;
    el.muted = this.silenciados.has(l.peerId);
    el.volume = this.volume;
    el.style.display = "none";
    document.body.appendChild(el);
    void el.play().catch(() => {}); // se o navegador bloquear, volta a tentar no próximo toque
    l.audio = el;

    // medidor de fala (o áudio em si toca pelo <audio>; isto só observa)
    const ac = this.contextoAudio();
    l.fonte = ac.createMediaStreamSource(stream);
    l.analisador = ac.createAnalyser();
    l.analisador.fftSize = 256;
    l.fonte.connect(l.analisador);
    l.conectada = true;
    this.ev.aoMudar();
  }

  private remover(l: Ligacao, fecharCall: boolean): void {
    if (fecharCall) { try { l.call.close(); } catch { /* ignore */ } }
    l.audio?.remove();
    l.fonte?.disconnect();
    l.audio = null;
    l.fonte = null;
    l.analisador = null;
    if (this.ligacoes.get(l.peerId) === l) {
      this.ligacoes.delete(l.peerId);
      this.ev.aoMudar();
    }
  }

  // mantém só as chamadas deste contexto cujos peerIds estão na lista (fecha as demais)
  manter(contexto: ContextoVoz, peerIds: string[]): void {
    for (const l of [...this.ligacoes.values()]) {
      if (l.contexto === contexto && !peerIds.includes(l.peerId)) this.remover(l, true);
    }
  }

  // tentativa que ainda não conectou (o outro lado não estava pronto): fecha para ligar de novo agora
  descartarSeNaoConectou(peerId: string): void {
    const l = this.ligacoes.get(peerId);
    if (l && !l.conectada) this.remover(l, true);
  }

  fecharContexto(contexto: ContextoVoz): void {
    this.manter(contexto, []);
  }

  fecharTudo(): void {
    for (const l of [...this.ligacoes.values()]) this.remover(l, true);
  }

  // ---- o que eu ouço ----

  silenciar(peerId: string, silenciado: boolean): void {
    if (silenciado) this.silenciados.add(peerId); else this.silenciados.delete(peerId);
    const l = this.ligacoes.get(peerId);
    if (l?.audio) l.audio.muted = silenciado;
    this.ev.aoMudar();
  }

  estaSilenciado(peerId: string): boolean {
    return this.silenciados.has(peerId);
  }

  definirVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    for (const l of this.ligacoes.values()) if (l.audio) l.audio.volume = this.volume;
  }

  // ---- quem está falando ----

  // atualiza os medidores; devolve true se alguém começou ou parou de falar (para redesenhar a tela)
  atualizarNiveis(): boolean {
    const agora = performance.now();
    let mudou = false;
    for (const l of this.ligacoes.values()) {
      const antes = agora < l.falandoAte;
      if (this.nivelRecebido(l) > LIMIAR_FALA) l.falandoAte = agora + PERSISTENCIA_MS;
      if ((agora < l.falandoAte) !== antes) mudou = true;
    }
    if (this.analisadorMic) {
      const antes = agora < this.meuFalandoAte;
      if (rms(this.analisadorMic, this.buffer) > LIMIAR_FALA) this.meuFalandoAte = agora + PERSISTENCIA_MS;
      if ((agora < this.meuFalandoAte) !== antes) mudou = true;
    }
    return mudou;
  }

  // nível de voz que está chegando de uma pessoa (0 a 1). O próprio WebRTC informa o nível por fonte de áudio, o que não
  // depende de WebAudio (que às vezes entrega silêncio para streams remotos); o analisador fica só como reserva.
  private nivelRecebido(l: Ligacao): number {
    const receptor = l.call.peerConnection?.getReceivers().find((r) => r.track?.kind === "audio");
    const fontes = receptor && typeof receptor.getSynchronizationSources === "function" ? receptor.getSynchronizationSources() : null;
    if (fontes && fontes.length > 0) return Math.max(...fontes.map((f) => f.audioLevel ?? 0));
    return l.analisador ? rms(l.analisador, this.buffer) : 0;
  }

  get euFalando(): boolean {
    return this.microfone && performance.now() < this.meuFalandoAte;
  }

  participantes(): Participante[] {
    const agora = performance.now();
    return [...this.ligacoes.values()].map((l) => ({
      peerId: l.peerId,
      contexto: l.contexto,
      silenciado: this.silenciados.has(l.peerId),
      falando: !this.silenciados.has(l.peerId) && agora < l.falandoAte,
      conectado: l.conectada,
    }));
  }
}
