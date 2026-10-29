// Tela cheia em todos os aparelhos.
// Android, iPad e computador: Fullscreen API (com o prefixo webkit do Safari).
// iPhone: o Safari não deixa página nenhuma entrar em tela cheia; o jeito é "Adicionar à Tela de Início" —
// aberto pelo ícone, o jogo roda sem a barra de endereços (manifest.webmanifest com display: fullscreen).

type DocWebkit = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type ElWebkit = HTMLElement & { webkitRequestFullscreen?: () => void };

const doc = document as DocWebkit;
const raiz = document.documentElement as ElWebkit;

// aberto pelo ícone da Tela de Início (já sem barra de endereços)
export function instalado(): boolean {
  return (
    matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function emTelaCheia(): boolean {
  return !!(document.fullscreenElement || doc.webkitFullscreenElement);
}

export function suportaTelaCheia(): boolean {
  return !!(raiz.requestFullscreen || raiz.webkitRequestFullscreen);
}

export async function entrarTelaCheia(): Promise<boolean> {
  try {
    if (raiz.requestFullscreen) await raiz.requestFullscreen();
    else if (raiz.webkitRequestFullscreen) raiz.webkitRequestFullscreen();
    else return false;
    // celular: tenta travar na horizontal (nem todo navegador deixa)
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape").catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function sairTelaCheia(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else doc.webkitExitFullscreen?.();
}

// botão de tela cheia: entra/sai; se o navegador não deixa (iPhone), chama `semSuporte` para explicar o atalho
export function alternarTelaCheia(semSuporte: () => void): void {
  if (emTelaCheia()) sairTelaCheia();
  else if (suportaTelaCheia()) void entrarTelaCheia();
  else semSuporte();
}
