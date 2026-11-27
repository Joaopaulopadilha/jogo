// O stick virtual (celular e tablet): nasce onde o dedo toca; empurrando um pouco anda, até o fim corre.

export const ZONA_MORTA = 0.22; // tremidinhas do dedo não fazem andar
export const LIMIAR_CORRER = 0.85;

export interface Stick {
  cx: number; // centro (px da tela)
  cy: number;
  x: number; // -1 (esquerda) a 1 (direita)
  y: number; // -1 a 1, só para desenhar o pino
}

export function novoStick(px: number, py: number): Stick {
  return { cx: px, cy: py, x: 0, y: 0 };
}

// o dedo se moveu. Passando da borda, o centro vai junto: assim virar para o outro lado é imediato.
export function moverStick(s: Stick, px: number, py: number, raio: number): void {
  let dx = px - s.cx;
  let dy = py - s.cy;
  const d = Math.hypot(dx, dy);
  if (d > raio) {
    s.cx += (dx / d) * (d - raio);
    s.cy += (dy / d) * (d - raio);
    dx = px - s.cx;
    dy = py - s.cy;
  }
  s.x = Math.max(-1, Math.min(1, dx / raio));
  s.y = Math.max(-1, Math.min(1, dy / raio));
}

export function leituraDoStick(s: Stick | null): { esquerda: boolean; direita: boolean; correr: boolean } {
  const x = s?.x ?? 0;
  return { esquerda: x < -ZONA_MORTA, direita: x > ZONA_MORTA, correr: Math.abs(x) >= LIMIAR_CORRER };
}
