// Personagens jogáveis: cada um é um modelo com o mesmo esqueleto e as mesmas animações (feitos no Blender, pasta modelos/).
export interface Personagem {
  id: string;
  nome: string;
  icone: string;
  arquivo: string;
}

export const PERSONAGENS: Personagem[] = [
  { id: "operario", nome: "Operário", icone: "👷", arquivo: "operario.glb" },
  { id: "lhama", nome: "Lhama aventureira", icone: "🦙", arquivo: "lhama.glb" },
];

export const PERSONAGEM_PADRAO = PERSONAGENS[0].id;

// id desconhecido (ex.: jogador com versão mais nova) cai no operário
export function urlPersonagem(id: string): string {
  const p = PERSONAGENS.find((x) => x.id === id) ?? PERSONAGENS[0];
  return `${import.meta.env.BASE_URL}modelos/${p.arquivo}`;
}

export function personagemValido(id: unknown): string {
  return PERSONAGENS.some((x) => x.id === id) ? String(id) : PERSONAGEM_PADRAO;
}
