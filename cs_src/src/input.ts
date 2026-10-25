// input.ts
// Teclado + mouse (pointer lock) e toque (analógico virtual + arrastar para mirar).
// yaw/pitch são mantidos aqui e enviados em cada comando.

const SENSIBILIDADE = 0.0022;
const SENSIBILIDADE_TOQUE = 0.005;

// diário curto dos eventos que mexem no mouse (para investigar cursor preso): no console, ou em window.__csLog
const diario: string[] = [];
function registrar(evento: string): void {
  const linha = `${(performance.now() / 1000).toFixed(1)}s ${evento}`;
  diario.push(linha);
  if (diario.length > 60) diario.shift();
  (window as unknown as { __csLog?: string[] }).__csLog = diario;
  console.log("[cs]", linha);
}

export class Entrada {
  yaw = 0;
  pitch = 0;
  travado = false; // no toque significa apenas "partida ativa, sem pausa"
  placar = false;
  arma = 0; // slot selecionado: 0 rifle, 1 pistola, 2 granada
  sensibilidade = 1; // multiplicador da mira (ajuste do jogador)

  // celular/tablet: dedo como ponteiro principal, sem mouse
  readonly toque = window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  private teclas = new Set<string>();
  private atirando = false;
  private recarregar = false;
  private joyX = 0;
  private joyY = 0;
  private puloToque = false;

  constructor(private canvas: HTMLElement, private aoMudarTravamento: (travado: boolean) => void) {
    document.addEventListener("pointerlockchange", () => {
      registrar(`pointerlockchange: ${document.pointerLockElement ? "travado" : "solto"}`);
      if (this.toque) return;
      this.travado = document.pointerLockElement === this.canvas;
      if (!this.travado) this.limpar();
      aoMudarTravamento(this.travado);
    });

    // pedido de trava que falhou, ou janela que perdeu o foco: solta o cursor
    document.addEventListener("pointerlockerror", () => { registrar("pointerlockerror"); this.liberarCursor(); });
    window.addEventListener("blur", () => { registrar("janela perdeu o foco"); this.liberarCursor(); });
    window.addEventListener("focus", () => registrar("janela ganhou o foco"));
    document.addEventListener("visibilitychange", () => registrar(`aba ${document.hidden ? "escondida" : "visível"}`));
    document.addEventListener("fullscreenchange", () => registrar(`tela cheia: ${!!document.fullscreenElement}`));

    document.addEventListener("mousemove", (e) => {
      if (this.toque || !this.travado) return;
      this.yaw -= e.movementX * SENSIBILIDADE * this.sensibilidade;
      this.pitch -= e.movementY * SENSIBILIDADE * this.sensibilidade;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    });

    document.addEventListener("mousedown", (e) => {
      if (!this.toque && this.travado && e.button === 0) this.atirando = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (!this.toque && e.button === 0) this.atirando = false;
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && this.travado) { e.preventDefault(); this.placar = true; return; }
      if (!this.travado) return;
      if (e.code === "Space") e.preventDefault();
      if (e.code === "KeyR" && !e.repeat) this.recarregar = true;
      if (e.code === "Digit1") this.arma = 0;
      else if (e.code === "Digit2") this.arma = 1;
      else if (e.code === "Digit3") this.arma = 2;
      this.teclas.add(e.code);
    });
    document.addEventListener("keyup", (e) => {
      if (e.key === "Tab") { this.placar = false; return; }
      this.teclas.delete(e.code);
    });
    window.addEventListener("blur", () => this.limpar());
  }

  private limpar(): void {
    this.teclas.clear();
    this.atirando = false;
    this.placar = false;
    this.joyX = 0;
    this.joyY = 0;
    this.puloToque = false;
  }

  travar(): void {
    if (this.toque) {
      this.prepararTela();
      if (!this.travado) { this.travado = true; this.aoMudarTravamento(true); }
      return;
    }
    // sem gesto do usuário (ex.: a partida do grupo começou sozinha) ou sem foco, o navegador recusa; pedir assim às vezes
    // deixa o cursor preso numa área pequena da tela. Então só pede com gesto: senão fica o painel "Clique para jogar".
    if (navigator.userActivation && !navigator.userActivation.isActive) { registrar("travar() ignorado: sem gesto do usuário"); return; }
    if (!document.hasFocus()) { registrar("travar() ignorado: janela sem foco"); return; }
    registrar("travar() pedindo o mouse");
    // pode rejeitar se o usuário acabou de sair com Esc; nesse caso o painel de pausa continua
    const r = this.canvas.requestPointerLock() as unknown;
    if (r instanceof Promise) r.catch(() => {});
  }

  soltar(): void {
    if (this.toque) {
      if (this.travado) { this.travado = false; this.limpar(); this.aoMudarTravamento(false); }
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // rede de segurança: nada de cursor preso fora da partida
  liberarCursor(): void {
    if (!this.toque && document.pointerLockElement) document.exitPointerLock();
  }

  // ---- Tela cheia ----

  private saiuPorEscolha = false; // o jogador saiu da tela cheia pelo nosso botão: não puxar de volta sozinho

  get telaCheiaDisponivel(): boolean {
    return !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
  }

  // entra em tela cheia (esconde a barra de endereço) e, onde existe, trava a orientação na horizontal.
  // Precisa de um toque do usuário. No iPhone o Safari não oferece isso para sites
  private entrarTelaCheia(): void {
    const travarPaisagem = () => {
      const o = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
      o?.lock?.("landscape")?.catch(() => {});
    };
    if (document.fullscreenElement || !this.telaCheiaDisponivel) { travarPaisagem(); return; }
    document.documentElement.requestFullscreen().then(travarPaisagem).catch(travarPaisagem);
  }

  // celular/tablet: chamado a cada toque. (Re)entra em tela cheia, por exemplo depois de girar o aparelho
  // (muitos navegadores saem dela ao girar), a menos que o jogador tenha saído de propósito
  prepararTela(): void {
    if (!this.toque || this.saiuPorEscolha || document.fullscreenElement) return;
    this.entrarTelaCheia();
  }

  // botão de tela cheia: entra ou sai. "indisponivel" = o navegador não oferece (ex.: iPhone)
  alternarTelaCheia(): "entrou" | "saiu" | "indisponivel" {
    if (!this.telaCheiaDisponivel) return "indisponivel";
    if (document.fullscreenElement) {
      this.saiuPorEscolha = true;
      void document.exitFullscreen().catch(() => {});
      return "saiu";
    }
    this.saiuPorEscolha = false;
    this.entrarTelaCheia();
    return "entrou";
  }

  // ---- Toque ----

  olharToque(dx: number, dy: number): void {
    if (!this.travado) return;
    this.yaw -= dx * SENSIBILIDADE_TOQUE * this.sensibilidade;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * SENSIBILIDADE_TOQUE * this.sensibilidade));
  }

  moverToque(x: number, y: number): void {
    this.joyX = x;
    this.joyY = y;
  }

  fogoToque(ativo: boolean): void {
    this.atirando = ativo && this.travado;
  }

  puloToqueAtivo(ativo: boolean): void {
    this.puloToque = ativo;
  }

  recarregarToque(): void {
    if (this.travado) this.recarregar = true;
  }

  alternarPlacar(): void {
    this.placar = !this.placar;
  }

  ler(): { fwd: number; strafe: number; jump: boolean; fire: boolean; reload: boolean } {
    const t = this.teclas;
    const limitar = (v: number) => Math.max(-1, Math.min(1, v));
    const fwd = (t.has("KeyW") || t.has("ArrowUp") ? 1 : 0) - (t.has("KeyS") || t.has("ArrowDown") ? 1 : 0);
    const strafe = (t.has("KeyD") || t.has("ArrowRight") ? 1 : 0) - (t.has("KeyA") || t.has("ArrowLeft") ? 1 : 0);
    const reload = this.recarregar;
    this.recarregar = false;
    return {
      fwd: limitar(fwd + this.joyY),
      strafe: limitar(strafe + this.joyX),
      jump: t.has("Space") || this.puloToque,
      fire: this.atirando,
      reload,
    };
  }
}
