// Controles de toque (celular e tablet): dois manches virtuais e botões.
// Os manches valem de -1 a 1 em x (direita +) e y (para baixo +), como um controle de videogame.

// segue o dedo mesmo se ele sair de cima do elemento (alguns navegadores recusam: segue sem)
function capturar(el: HTMLElement, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    /* sem captura */
  }
}

export class Manche {
  x = 0;
  y = 0;
  private dedo: number | null = null;
  private readonly pino: HTMLElement;
  readonly rotulos: { cima: HTMLElement; baixo: HTMLElement; esq: HTMLElement; dir: HTMLElement };

  constructor(readonly el: HTMLElement) {
    el.classList.add("manche");
    el.innerHTML = `<div class="manche-pino"></div>
      <span class="manche-rotulo cima"></span><span class="manche-rotulo baixo"></span>
      <span class="manche-rotulo esq"></span><span class="manche-rotulo dir"></span>`;
    this.pino = el.querySelector(".manche-pino")!;
    const r = (c: string) => el.querySelector<HTMLElement>(".manche-rotulo." + c)!;
    this.rotulos = { cima: r("cima"), baixo: r("baixo"), esq: r("esq"), dir: r("dir") };
    el.addEventListener("pointerdown", (e) => {
      if (this.dedo !== null) return;
      this.dedo = e.pointerId;
      capturar(el, e.pointerId);
      this.mover(e);
      e.preventDefault();
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.dedo) this.mover(e);
    });
    const soltar = (e: PointerEvent) => {
      if (e.pointerId !== this.dedo) return;
      this.dedo = null;
      this.x = this.y = 0;
      this.pino.style.transform = "translate(-50%, -50%)";
    };
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);
  }

  rotular(cima: string, baixo: string, esq: string, dir: string): void {
    this.rotulos.cima.textContent = cima;
    this.rotulos.baixo.textContent = baixo;
    this.rotulos.esq.textContent = esq;
    this.rotulos.dir.textContent = dir;
  }

  private mover(e: PointerEvent): void {
    const r = this.el.getBoundingClientRect();
    const raio = r.width / 2;
    let dx = (e.clientX - (r.left + raio)) / raio;
    let dy = (e.clientY - (r.top + raio)) / raio;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      dx /= d;
      dy /= d;
    }
    // zona morta pequena no meio e resposta suave
    const zona = (v: number) => (Math.abs(v) < 0.12 ? 0 : Math.sign(v) * ((Math.abs(v) - 0.12) / 0.88));
    this.x = zona(dx);
    this.y = zona(dy);
    this.pino.style.transform = `translate(calc(-50% + ${dx * raio * 0.7}px), calc(-50% + ${dy * raio * 0.7}px))`;
  }
}

// botão que fica "apertado" enquanto o dedo está nele
export function botaoSegurar(el: HTMLElement): { apertado: boolean } {
  const estado = { apertado: false };
  el.addEventListener("pointerdown", (e) => {
    estado.apertado = true;
    capturar(el, e.pointerId);
    el.classList.add("apertado");
    e.preventDefault();
  });
  const soltar = () => {
    estado.apertado = false;
    el.classList.remove("apertado");
  };
  el.addEventListener("pointerup", soltar);
  el.addEventListener("pointercancel", soltar);
  return estado;
}

export const ehToque = (): boolean =>
  new URLSearchParams(location.search).has("toque") ||
  matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 0 && !matchMedia("(pointer: fine)").matches);
