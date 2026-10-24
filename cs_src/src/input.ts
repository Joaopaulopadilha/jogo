// input.ts
// Teclado + mouse (pointer lock). yaw/pitch são mantidos aqui e enviados em cada comando.

const SENSIBILIDADE = 0.0022;

export class Entrada {
  yaw = 0;
  pitch = 0;
  travado = false;
  placar = false;
  arma = 0; // slot selecionado: 0 rifle, 1 pistola, 2 granada

  private teclas = new Set<string>();
  private atirando = false;
  private recarregar = false;

  constructor(private canvas: HTMLElement, aoMudarTravamento: (travado: boolean) => void) {
    document.addEventListener("pointerlockchange", () => {
      this.travado = document.pointerLockElement === this.canvas;
      if (!this.travado) this.limpar();
      aoMudarTravamento(this.travado);
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.travado) return;
      this.yaw -= e.movementX * SENSIBILIDADE;
      this.pitch -= e.movementY * SENSIBILIDADE;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    });

    document.addEventListener("mousedown", (e) => {
      if (this.travado && e.button === 0) this.atirando = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.atirando = false;
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
  }

  travar(): void {
    // pode rejeitar se o usuário acabou de sair com Esc; nesse caso o painel de pausa continua
    const r = this.canvas.requestPointerLock() as unknown;
    if (r instanceof Promise) r.catch(() => {});
  }

  soltar(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  ler(): { fwd: number; strafe: number; jump: boolean; fire: boolean; reload: boolean } {
    const t = this.teclas;
    const fwd = (t.has("KeyW") || t.has("ArrowUp") ? 1 : 0) - (t.has("KeyS") || t.has("ArrowDown") ? 1 : 0);
    const strafe = (t.has("KeyD") || t.has("ArrowRight") ? 1 : 0) - (t.has("KeyA") || t.has("ArrowLeft") ? 1 : 0);
    const reload = this.recarregar;
    this.recarregar = false;
    return { fwd, strafe, jump: t.has("Space"), fire: this.atirando, reload };
  }
}
