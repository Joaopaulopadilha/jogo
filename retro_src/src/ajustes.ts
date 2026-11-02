// Ajustes de controle (sensibilidades, câmera, controle, som), guardados no navegador.
export interface Ajustes {
  mouse: number; // multiplicador da sensibilidade da câmera com o mouse
  toque: number; // idem, arrastando o dedo
  zoom: number; // roda do mouse e pinça
  invertY: boolean; // inverte a câmera na vertical
  zona: number; // zona morta dos manches do controle (0 a 0,4)
  volume: number; // 0 a 1
}

export const PADRAO: Ajustes = { mouse: 1, toque: 1, zoom: 1, invertY: false, zona: 0.15, volume: 1 };
const CHAVE = "retro-ajustes";

export const ajustes: Ajustes = { ...PADRAO };

try {
  Object.assign(ajustes, JSON.parse(localStorage.getItem(CHAVE) ?? "{}"));
} catch {
  /* sem ajustes salvos */
}

function salvar(): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(ajustes));
  } catch {
    /* ignora */
  }
}

// liga os controles do menu (elementos com data-aj="nome") aos ajustes; aoMudar avisa o jogo (ex.: volume)
export function ligarMenuAjustes(raiz: HTMLElement, aoMudar: () => void): void {
  const campos = [...raiz.querySelectorAll<HTMLInputElement>("[data-aj]")];
  const mostrar = (): void => {
    for (const c of campos) {
      const k = c.dataset.aj as keyof Ajustes;
      if (c.type === "checkbox") c.checked = ajustes[k] as boolean;
      else {
        c.value = String(ajustes[k]);
        const saida = c.parentElement?.querySelector("output");
        const v = ajustes[k] as number;
        if (saida) saida.textContent = k === "zona" || k === "volume" ? `${Math.round(v * 100)}%` : `${v.toFixed(2).replace(/0$/, "").replace(".", ",")}×`;
      }
    }
  };
  for (const c of campos) {
    c.addEventListener("input", () => {
      const k = c.dataset.aj as keyof Ajustes;
      (ajustes[k] as number | boolean) = c.type === "checkbox" ? c.checked : Number(c.value);
      mostrar();
      salvar();
      aoMudar();
    });
  }
  raiz.querySelector("#aj-padrao")?.addEventListener("click", () => {
    Object.assign(ajustes, PADRAO);
    mostrar();
    salvar();
    aoMudar();
  });
  mostrar();
}
