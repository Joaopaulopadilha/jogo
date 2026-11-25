// Sinais que um jogador faz para o parceiro (só no 2x2). O parceiro sempre vê; cada adversário tem uma chance
// de "pegar no flagra". Quem decide quem viu é o anfitrião, para ninguém conseguir forçar ver o sinal alheio.

export interface Sinal {
  id: string;
  emoji: string;
  texto: string; // "<nome> piscou o olho"
}

export const SINAIS: Sinal[] = [
  { id: "piscar", emoji: "😉", texto: "piscou o olho" },
  { id: "lingua", emoji: "😛", texto: "mostrou a língua" },
  { id: "ombro", emoji: "🤷", texto: "balançou o ombro" },
  { id: "sobrancelha", emoji: "🤨", texto: "levantou a sobrancelha" },
  { id: "biquinho", emoji: "😗", texto: "fez biquinho" },
];

export const CHANCE_FLAGRA = 0.3; // chance de cada adversário perceber o sinal
export const INTERVALO_SINAL_MS = 1500; // evita spam
