// Colisões simples por "blocos": prismas verticais (retângulo girado em y, ou círculo) com altura de y0 a y1.
// Servem para o operário (empurrar, ficar em pé em cima, escalar) e para a máquina (não atravessar caminhão e árvores).
// Convenção de giro igual à do three.js (rotation.y): local → mundo  x = cx + lx·cos + lz·sin,  z = cz − lx·sin + lz·cos.

export interface Bloco {
  circulo: boolean;
  x: number; // centro
  z: number;
  rumo: number; // giro em y (só caixa)
  hx: number; // meia largura (caixa) ou raio (círculo)
  hz: number;
  y0: number;
  y1: number;
  escalavel: boolean;
}

export function caixa(x: number, z: number, rumo: number, hx: number, hz: number, y0: number, y1: number, escalavel = true): Bloco {
  return { circulo: false, x, z, rumo, hx, hz, y0, y1, escalavel };
}

export function circulo(x: number, z: number, r: number, y0: number, y1: number, escalavel = false): Bloco {
  return { circulo: true, x, z, rumo: 0, hx: r, hz: r, y0, y1, escalavel };
}

function paraLocal(b: Bloco, x: number, z: number): [number, number] {
  const dx = x - b.x;
  const dz = z - b.z;
  const c = Math.cos(b.rumo);
  const s = Math.sin(b.rumo);
  return [dx * c - dz * s, dx * s + dz * c];
}

function paraMundo(b: Bloco, lx: number, lz: number): [number, number] {
  const c = Math.cos(b.rumo);
  const s = Math.sin(b.rumo);
  return [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
}

// o ponto (x, z) está sobre o bloco?
export function contem(b: Bloco, x: number, z: number): boolean {
  if (b.circulo) return Math.hypot(x - b.x, z - b.z) <= b.hx;
  const [lx, lz] = paraLocal(b, x, z);
  return Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz;
}

// ponto 3D dentro do bloco?
export function dentro(b: Bloco, x: number, y: number, z: number): boolean {
  return y >= b.y0 && y <= b.y1 && contem(b, x, z);
}

export interface Empurrao {
  x: number; // nova posição
  z: number;
  nx: number; // normal (do bloco para fora)
  nz: number;
  bx: number; // ponto da borda do bloco mais perto
  bz: number;
}

// empurra um círculo de raio r para fora do bloco (só no plano xz); null se não encosta
export function empurrar(b: Bloco, x: number, z: number, r: number): Empurrao | null {
  if (b.circulo) {
    const dx = x - b.x;
    const dz = z - b.z;
    const d = Math.hypot(dx, dz);
    if (d >= b.hx + r) return null;
    const nx = d > 1e-6 ? dx / d : 1;
    const nz = d > 1e-6 ? dz / d : 0;
    return { x: b.x + nx * (b.hx + r), z: b.z + nz * (b.hx + r), nx, nz, bx: b.x + nx * b.hx, bz: b.z + nz * b.hx };
  }
  const [lx, lz] = paraLocal(b, x, z);
  const cx = Math.max(-b.hx, Math.min(b.hx, lx));
  const cz = Math.max(-b.hz, Math.min(b.hz, lz));
  let dx = lx - cx;
  let dz = lz - cz;
  const d = Math.hypot(dx, dz);
  let nlx: number;
  let nlz: number;
  let bx = cx;
  let bz = cz;
  if (d > 1e-6) {
    if (d >= r) return null;
    nlx = dx / d;
    nlz = dz / d;
  } else {
    // centro dentro do retângulo: sai pelo lado mais perto
    const px = b.hx - Math.abs(lx);
    const pz = b.hz - Math.abs(lz);
    if (px < pz) {
      nlx = Math.sign(lx) || 1;
      nlz = 0;
      bx = nlx * b.hx;
    } else {
      nlx = 0;
      nlz = Math.sign(lz) || 1;
      bz = nlz * b.hz;
    }
    dx = dz = 0;
  }
  const [nx0, nz0] = paraMundo({ ...b, x: 0, z: 0 }, nlx, nlz);
  const [px, pz] = paraMundo(b, bx + nlx * r, bz + nlz * r);
  const [ex, ez] = paraMundo(b, bx, bz);
  return { x: px, z: pz, nx: nx0, nz: nz0, bx: ex, bz: ez };
}

// cantos de uma caixa no plano xz
function cantos(b: Bloco): [number, number][] {
  return [[-b.hx, -b.hz], [b.hx, -b.hz], [b.hx, b.hz], [-b.hx, b.hz]].map(([lx, lz]) => paraMundo(b, lx, lz));
}

// duas caixas se cruzam no plano xz? (teorema do eixo separador)
export function caixasSeCruzam(a: Bloco, b: Bloco): boolean {
  const ca = cantos(a);
  const cb = cantos(b);
  for (const r of [a.rumo, b.rumo]) {
    for (const [ax, az] of [[Math.cos(r), -Math.sin(r)], [Math.sin(r), Math.cos(r)]]) {
      const pa = ca.map(([x, z]) => x * ax + z * az);
      const pb = cb.map(([x, z]) => x * ax + z * az);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

// caixa x círculo no plano xz
export function caixaECirculo(cx: Bloco, c: Bloco): boolean {
  return empurrar(cx, c.x, c.z, c.hx) !== null || contem(cx, c.x, c.z);
}
