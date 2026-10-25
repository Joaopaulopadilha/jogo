// input.ts
// Teclado + mouse (pointer lock) e toque (analógico virtual + arrastar para mirar).
// yaw/pitch são mantidos aqui e enviados em cada comando.

const SENSIBILIDADE = 0.0022;
const SENSIBILIDADE_TOQUE = 0.005;

export class Entrada {
  yaw = 0;
  pitch = 0;
  travado = false; // no toque significa apenas "partida ativa, sem pausa"
  placar = false;
  arma = 0; // slot selecionado: 0 rifle, 1 pistola, 2 granada

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
      if (this.toque) return;
      this.travado = document.pointerLockElement === this.canvas;
      if (!this.travado) this.limpar();
      aoMudarTravamento(this.travado);
    });

    document.addEventListener("mousemove", (e) => {
      if (this.toque || !this.travado) return;
      this.yaw -= e.movementX * SENSIBILIDADE;
      this.pitch -= e.movementY * SENSIBILIDADE;
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

  // celular/tablet: tela cheia (esconde as barras do navegador) e orientação travada na horizontal.
  // Precisa de um toque do usuário. No Android funciona; no iPhone não existe, e quem cobre é o aviso "gire o aparelho".
  prepararTela(): void {
    if (!this.toque) return;
    const travarPaisagem = () => {
      const o = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
      o?.lock?.("landscape")?.catch(() => {});
    };
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) { travarPaisagem(); return; }
    el.requestFullscreen().then(travarPaisagem).catch(travarPaisagem);
  }

  // ---- Toque ----

  olharToque(dx: number, dy: number): void {
    if (!this.travado) return;
    this.yaw -= dx * SENSIBILIDADE_TOQUE;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * SENSIBILIDADE_TOQUE));
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
