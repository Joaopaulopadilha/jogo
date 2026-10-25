// ajustes.ts
// Preferências do jogador neste aparelho (brilho, qualidade gráfica, sensibilidade). Ficam salvas no navegador.

import { suporteWebGL } from "./webgl";

export type Qualidade = "baixa" | "media" | "alta";

export interface Ajustes {
  brilho: number;        // 1 = normal; acima de 1 clareia a imagem
  qualidade: Qualidade;  // resolução da renderização 3D
  sensibilidade: number; // multiplicador da mira (mouse e toque)
}

const CHAVE = "cs_ajustes";
const QUALIDADES: Qualidade[] = ["baixa", "media", "alta"];

export const LIMITES = {
  brilho: { min: 0.6, max: 2.2 },
  sensibilidade: { min: 0.4, max: 2.5 },
};

const limitar = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

// celular e tablet começam em qualidade média (telas densas pesam na bateria e na GPU); placa só com WebGL 1
// (antiga) começa em baixa
export function ajustesPadrao(): Ajustes {
  const toque = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const antiga = !suporteWebGL().v2;
  return { brilho: 1, qualidade: antiga ? "baixa" : toque ? "media" : "alta", sensibilidade: 1 };
}

export function carregarAjustes(): Ajustes {
  const base = ajustesPadrao();
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return base;
    const d = JSON.parse(bruto) as Partial<Ajustes>;
    return {
      brilho: typeof d.brilho === "number" && isFinite(d.brilho) ? limitar(d.brilho, LIMITES.brilho.min, LIMITES.brilho.max) : base.brilho,
      qualidade: QUALIDADES.includes(d.qualidade as Qualidade) ? (d.qualidade as Qualidade) : base.qualidade,
      sensibilidade:
        typeof d.sensibilidade === "number" && isFinite(d.sensibilidade)
          ? limitar(d.sensibilidade, LIMITES.sensibilidade.min, LIMITES.sensibilidade.max)
          : base.sensibilidade,
    };
  } catch {
    return base; // dados corrompidos ou sem armazenamento: usa o padrão
  }
}

export function salvarAjustes(a: Ajustes): void {
  try { localStorage.setItem(CHAVE, JSON.stringify(a)); } catch { /* sem armazenamento */ }
}
