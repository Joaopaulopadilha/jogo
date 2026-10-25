// toque.ts
// Controles na tela para celular/tablet: analógico à esquerda, arrastar à direita para mirar,
// botões de fogo, pulo, recarga, placar e pausa. Multitoque via Pointer Events.

import type { Entrada } from "./input";

const RAIO_ANALOGICO = 56; // px
const ZONA_MORTA = 0.12;

interface Rastreio {
  inicio?(e: PointerEvent): void;
  mover?(dx: number, dy: number, e: PointerEvent): void;
  fim?(): void;
}

// acompanha um dedo por vez em um elemento; dx/dy são relativos ao último movimento
function rastrear(el: HTMLElement, cb: Rastreio): void {
  let id = -1;
  let ux = 0;
  let uy = 0;

  el.addEventListener("pointerdown", (e) => {
    if (id !== -1) return;
    e.preventDefault(); // evita os eventos de mouse sintéticos (que disparariam tiro)
    id = e.pointerId;
    ux = e.clientX;
    uy = e.clientY;
    el.setPointerCapture(id);
    cb.inicio?.(e);
  });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerId !== id) return;
    e.preventDefault();
    cb.mover?.(e.clientX - ux, e.clientY - uy, e);
    ux = e.clientX;
    uy = e.clientY;
  });
  const fim = (e: PointerEvent) => {
    if (e.pointerId !== id) return;
    id = -1;
    cb.fim?.();
  };
  el.addEventListener("pointerup", fim);
  el.addEventListener("pointercancel", fim);
  el.addEventListener("lostpointercapture", fim);
}

export function montarToque(entrada: Entrada, aoPausar: () => void, aoAjustes: () => void): void {
  const q = (id: string) => document.getElementById(id)!;
  const raiz = q("toque");
  raiz.addEventListener("contextmenu", (e) => e.preventDefault());

  // mirar: arrastar em qualquer lugar livre
  rastrear(q("zonaOlhar"), { mover: (dx, dy) => entrada.olharToque(dx, dy) });

  // andar: analógico flutuante, aparece onde o dedo toca
  const base = q("joyBase");
  const knob = q("joyKnob");
  let ox = 0;
  let oy = 0;
  rastrear(q("zonaMover"), {
    inicio: (e) => {
      ox = e.clientX;
      oy = e.clientY;
      base.style.left = `${ox}px`;
      base.style.top = `${oy}px`;
      base.style.bottom = "auto";
      base.classList.add("ativo");
    },
    mover: (_dx, _dy, e) => {
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > RAIO_ANALOGICO) { dx = (dx / d) * RAIO_ANALOGICO; dy = (dy / d) * RAIO_ANALOGICO; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const x = dx / RAIO_ANALOGICO;
      const y = -dy / RAIO_ANALOGICO;
      if (Math.hypot(x, y) < ZONA_MORTA) entrada.moverToque(0, 0);
      else entrada.moverToque(x, y);
    },
    fim: () => {
      entrada.moverToque(0, 0);
      knob.style.transform = "";
      base.style.left = base.style.top = base.style.bottom = "";
      base.classList.remove("ativo");
    },
  });

  // fogo: segurar atira, e arrastar o mesmo dedo também mira
  const fogo = q("btnFogo");
  rastrear(fogo, {
    inicio: () => { entrada.fogoToque(true); fogo.classList.add("ativo"); },
    mover: (dx, dy) => entrada.olharToque(dx, dy),
    fim: () => { entrada.fogoToque(false); fogo.classList.remove("ativo"); },
  });

  const pulo = q("btnPulo");
  rastrear(pulo, {
    inicio: () => { entrada.puloToqueAtivo(true); pulo.classList.add("ativo"); },
    fim: () => { entrada.puloToqueAtivo(false); pulo.classList.remove("ativo"); },
  });

  rastrear(q("btnRecarregar"), { inicio: () => entrada.recarregarToque() });
  rastrear(q("btnPlacar"), { inicio: () => entrada.alternarPlacar() });
  rastrear(q("btnPausa"), { inicio: () => aoPausar() });
  rastrear(q("btnAjustesJogo"), { inicio: () => aoAjustes() });
}
