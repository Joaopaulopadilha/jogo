import { Desenho } from "./desenho.ts";
import { TOTAL_FASES, montarFase } from "./fases.ts";
import { Jogo, type Controles, type Estado } from "./jogo.ts";
import { Som } from "./som.ts";
import { leituraDoStick, moverStick, novoStick, type Stick } from "./stick.ts";

const app = document.getElementById("app") as HTMLElement;
const URL_HEROI = `${import.meta.env.BASE_URL}heroi.png`;
const heroi = new Image();
heroi.src = URL_HEROI;
const som = new Som();
const temToque = matchMedia("(pointer: coarse)").matches;
if (temToque) document.body.classList.add("com-toque");

// celular e tablet podem jogar com botões (setas) ou com um stick
type Controle = "botoes" | "stick";
let controle: Controle = localStorage.getItem("osmario-controle") === "stick" ? "stick" : "botoes";
function usarControle(c: Controle): void {
  controle = c;
  localStorage.setItem("osmario-controle", c);
  document.body.classList.toggle("usa-stick", temToque && c === "stick");
}
usarControle(controle);

const DT = 1 / 60;
let jogo: Jogo | null = null;
let desenho: Desenho | null = null;
let quadro = 0;
let antes = 0;
let sobra = 0;
let relogio = 0;
let pausado = false;
let estadoMostrado: Estado | "pausa" = "jogando";
let desdeFim = 0;
let observador: ResizeObserver | null = null;
let trava: WakeLockSentinel | null = null;

const numero = (chave: string): number => Number(localStorage.getItem(chave)) || 0;
const liberadas = (): number => Math.min(TOTAL_FASES, Math.max(1, numero("osmario-liberadas")));

// ---------------- controles ----------------

const teclas = new Set<string>();
const toques = new Map<number, string>(); // dedo -> botão apertado
const pressionou = new Set<string>(); // toques rápidos que não podem se perder entre dois passos
let stick: Stick | null = null;
let dedoStick = -1;

const apertado = (...codigos: string[]): boolean => codigos.some((c) => teclas.has(c));
const noToque = (b: string): boolean => [...toques.values()].includes(b);

function controles(): Controles {
  const s = leituraDoStick(stick);
  const c: Controles = {
    esquerda: apertado("ArrowLeft", "KeyA") || noToque("esquerda") || s.esquerda,
    direita: apertado("ArrowRight", "KeyD") || noToque("direita") || s.direita,
    correr: apertado("ShiftLeft", "ShiftRight", "KeyJ", "KeyX") || noToque("correr") || s.correr,
    pulo: apertado("Space", "ArrowUp", "KeyW", "KeyK", "KeyZ") || noToque("pulo") || pressionou.has("pulo"),
    fogo: apertado("KeyF", "KeyL", "KeyC") || noToque("fogo") || pressionou.has("fogo"),
  };
  return c;
}

addEventListener("keydown", (e) => {
  if (!jogo) return;
  som.iniciar();
  if (e.code === "KeyP" || e.code === "Escape") { alternarPausa(); return; }
  if (e.code === "KeyM") { alternarSom(); return; }
  const cartao = document.querySelector<HTMLButtonElement>(".cartao:not(.escondido) .botao.destaque");
  if (cartao && !e.repeat && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); cartao.click(); return; }
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  teclas.add(e.code);
  if (!e.repeat && ["Space", "ArrowUp", "KeyW", "KeyK", "KeyZ"].includes(e.code)) pressionou.add("pulo");
  if (!e.repeat && ["KeyF", "KeyL", "KeyC"].includes(e.code)) pressionou.add("fogo");
});
addEventListener("keyup", (e) => teclas.delete(e.code));
addEventListener("blur", () => { teclas.clear(); toques.clear(); soltarStick(); });

// ---------------- stick virtual ----------------

const raioStick = (): number => (document.querySelector<HTMLElement>(".stick-base")?.offsetWidth ?? 130) / 2;

// desenha o stick onde o dedo está; solto, ele volta para o canto e fica mais apagado
function pintarStick(): void {
  const base = document.querySelector<HTMLElement>(".stick-base");
  const zona = base?.parentElement;
  if (!base || !zona) return;
  const pino = base.firstElementChild as HTMLElement;
  base.classList.toggle("ativo", !!stick);
  base.classList.toggle("correndo", leituraDoStick(stick).correr);
  if (!stick) {
    base.style.left = base.style.top = "";
    pino.style.transform = "";
    return;
  }
  const r = zona.getBoundingClientRect();
  base.style.left = `${stick.cx - r.left}px`;
  base.style.top = `${stick.cy - r.top}px`;
  const alcance = raioStick() * 0.62;
  pino.style.transform = `translate(${stick.x * alcance}px, ${stick.y * alcance}px)`;
}

function soltarStick(): void {
  stick = null;
  dedoStick = -1;
  pintarStick();
}

addEventListener("pointerdown", (e) => {
  if (dedoStick >= 0 || !(e.target as HTMLElement).closest(".zona-stick")) return;
  e.preventDefault();
  som.iniciar();
  dedoStick = e.pointerId;
  stick = novoStick(e.clientX, e.clientY);
  pintarStick();
});
addEventListener("pointermove", (e) => {
  if (e.pointerId !== dedoStick || !stick) return;
  moverStick(stick, e.clientX, e.clientY, raioStick());
  pintarStick();
});
for (const ev of ["pointerup", "pointercancel"] as const) addEventListener(ev, (e) => { if (e.pointerId === dedoStick) soltarStick(); });

function marcarBotoes(): void {
  document.querySelectorAll<HTMLElement>(".tecla").forEach((b) => b.classList.toggle("apertada", noToque(b.dataset.b ?? "")));
}

// o dedo pode deslizar de um botão para outro (esquerda <-> direita) sem soltar
function botaoEm(x: number, y: number): string {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>(".tecla")?.dataset.b ?? "";
}
addEventListener("pointerdown", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".tecla")?.dataset.b;
  if (!b) return;
  e.preventDefault();
  som.iniciar();
  (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  toques.set(e.pointerId, b);
  if (b === "pulo" || b === "fogo") pressionou.add(b);
  marcarBotoes();
});
addEventListener("pointermove", (e) => {
  const atual = toques.get(e.pointerId);
  if (atual !== "esquerda" && atual !== "direita") return;
  const b = botaoEm(e.clientX, e.clientY);
  if (b === "esquerda" || b === "direita") { toques.set(e.pointerId, b); marcarBotoes(); }
});
for (const ev of ["pointerup", "pointercancel"] as const) addEventListener(ev, (e) => { if (toques.delete(e.pointerId)) marcarBotoes(); });
addEventListener("contextmenu", (e) => { if (jogo) e.preventDefault(); });

// ---------------- telas ----------------

function desenharMenu(): void {
  const lib = liberadas();
  const recorde = numero("osmario-recorde");
  app.innerHTML = `
  <div class="tela">
    <h1 class="logo"><small>Super</small><span>Osmário</span></h1>
    <div class="heroi-menu" style="background-image:url('${URL_HEROI}')"></div>
    <button class="botao destaque" data-a="jogar" data-f="0">Jogar</button>
    <div class="fases">${Array.from({ length: TOTAL_FASES }, (_, i) => `<button class="botao" data-a="jogar" data-f="${i}" ${i < lib ? "" : "disabled"}>${i + 1}. ${montarFase(i).nome}${i < lib ? "" : " 🔒"}</button>`).join("")}</div>
    ${temToque ? `<div class="escolha"><span>Controle na tela</span>
      <button class="botao ${controle === "botoes" ? "escolhido" : ""}" data-a="controle" data-v="botoes">◀ ▶ Botões</button>
      <button class="botao ${controle === "stick" ? "escolhido" : ""}" data-a="controle" data-v="stick">🕹️ Stick</button></div>` : ""}
    ${recorde ? `<div class="sub">Recorde: <b>${recorde}</b></div>` : ""}
    <div class="sub">
      ${temToque && controle === "stick"
        ? "Toque no lado esquerdo e arraste o <b>stick</b>: pouco anda, <b>até o fim corre</b> · <b>PULAR</b> (segure para ir mais alto; toque de novo no ar para o <b>pulo duplo</b>) · com o foguinho, <b>🔥</b> atira."
        : temToque
        ? "<b>◀ ▶</b> andam · <b>PULAR</b> (segure para ir mais alto; toque de novo no ar para o <b>pulo duplo</b>) · segure <b>CORRER</b> para pegar velocidade · com o foguinho, <b>🔥</b> atira."
        : "<b>← →</b> ou <b>A D</b> andam · <b>Espaço</b> pula (segure para ir mais alto; aperte de novo no ar para o <b>pulo duplo</b>) · <b>Shift</b> corre · <b>F</b> atira fogo · <b>P</b> pausa · <b>M</b> som."}
      <br>Pule em cima das baratas e dos drones, bata a cabeça nos blocos <b>?</b>, coma a coxinha para crescer, pegue o <b>foguinho</b> nos blocos vermelhos e chegue à bandeira.
    </div>
    <a class="voltar" href="../index.html">← todos os jogos</a>
  </div>`;
}

function comecar(fase: number): void {
  som.iniciar();
  jogo = new Jogo(fase);
  pausado = false;
  estadoMostrado = "jogando";
  app.innerHTML = `
  <div id="jogo">
    <div id="palco"><canvas></canvas></div>
    <div class="hud">
      <div class="ficha">❤ <span id="vidas"></span></div>
      <div class="ficha">🪙 <span id="moedas"></span></div>
      <div class="ficha">★ <span id="pontos"></span></div>
      <div class="ficha poder escondido" id="poder" title="Foguinho">🔥</div>
      <div class="ficha fase" id="nome-fase"></div>
      <button data-a="som" title="Som (M)">${som.ligado ? "🔊" : "🔇"}</button>
      <button data-a="pausa" title="Pausa (P)">⏸</button>
    </div>
    <div class="toque">
      <div class="zona-stick"><div class="stick-base"><div class="stick-pino"></div></div></div>
      <div class="setas"><div class="tecla" data-b="esquerda">◀</div><div class="tecla" data-b="direita">▶</div></div>
      <div class="acoes"><div class="tecla acao fogo escondido" data-b="fogo" title="Atirar fogo">🔥</div><div class="tecla acao correr" data-b="correr">CORRER</div><div class="tecla acao pular" data-b="pulo">PULAR</div></div>
    </div>
    <div class="cartao escondido" id="cartao"></div>
  </div>`;
  const palco = document.getElementById("palco") as HTMLElement;
  const canvas = palco.querySelector("canvas") as HTMLCanvasElement;
  const medir = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(palco.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(palco.clientHeight * dpr));
  };
  medir();
  observador?.disconnect();
  observador = new ResizeObserver(medir);
  observador.observe(palco);
  desenho = new Desenho(canvas, heroi);
  void pedirTrava();
  cancelAnimationFrame(quadro);
  antes = performance.now();
  sobra = 0;
  quadro = requestAnimationFrame(rodar);
}

function sair(): void {
  cancelAnimationFrame(quadro);
  observador?.disconnect();
  jogo = null;
  desenho = null;
  teclas.clear();
  toques.clear();
  soltarStick();
  void trava?.release();
  trava = null;
  desenharMenu();
}

async function pedirTrava(): Promise<void> {
  try {
    if ("wakeLock" in navigator && !trava) {
      trava = await navigator.wakeLock.request("screen");
      trava.addEventListener("release", () => { trava = null; });
    }
  } catch { /* sem suporte */ }
}

function cartao(titulo: string, texto: string, botoes: string): void {
  const el = document.getElementById("cartao");
  if (!el) return;
  el.innerHTML = `<h1>${titulo}</h1><div class="sub">${texto}</div>${botoes}<button class="botao" data-a="menu">Menu</button>`;
  el.classList.remove("escondido");
}

const esconderCartao = (): void => document.getElementById("cartao")?.classList.add("escondido");

function alternarPausa(): void {
  if (!jogo || (jogo.estado !== "jogando" && !pausado)) return;
  pausado = !pausado;
  teclas.clear();
  soltarStick();
  if (pausado) {
    estadoMostrado = "pausa";
    cartaoDePausa();
  } else {
    estadoMostrado = "jogando";
    esconderCartao();
  }
}

function cartaoDePausa(): void {
  if (!jogo) return;
  const troca = temToque ? `<button class="botao" data-a="trocar-controle">Controle: ${controle === "stick" ? "🕹️ Stick" : "◀ ▶ Botões"}</button>` : "";
  cartao("Pausa", `Fase ${jogo.numero + 1}: ${jogo.fase.nome}`, `<button class="botao destaque" data-a="continuar">Continuar</button>${troca}`);
}

function alternarSom(): void {
  const ligado = som.alternar();
  const b = document.querySelector('[data-a="som"]');
  if (b) b.textContent = ligado ? "🔊" : "🔇";
}

function guardarProgresso(j: Jogo): void {
  if (j.estado === "venceuFase") localStorage.setItem("osmario-liberadas", String(Math.max(liberadas(), j.numero + 2)));
  if (j.pontos > numero("osmario-recorde")) localStorage.setItem("osmario-recorde", String(j.pontos));
}

// ---------------- laço ----------------

function texto(id: string, v: string): void {
  const e = document.getElementById(id);
  if (e && e.textContent !== v) e.textContent = v;
}

function rodar(agora: number): void {
  const j = jogo;
  if (!j || !desenho) return;
  quadro = requestAnimationFrame(rodar);
  const dt = Math.min(0.1, Math.max(0, (agora - antes) / 1000)); // aba que ficou parada não dá um salto no tempo
  antes = agora;
  if (!pausado) {
    sobra += dt;
    relogio += dt;
    // passos fixos: a física é igual em qualquer aparelho
    while (sobra >= DT) {
      sobra -= DT;
      for (const e of j.passo(DT, controles())) som.tocar(e);
      pressionou.clear();
    }
    if (j.estado === "jogando") som.musica(dt);
  }
  if (heroi.complete) desenho.desenhar(j, relogio);
  texto("vidas", String(j.vidas));
  texto("moedas", String(j.moedas));
  texto("pontos", String(j.pontos));
  texto("nome-fase", `${j.numero + 1}. ${j.fase.nome}`);
  // o botão de atirar e o ícone só aparecem com o foguinho
  document.getElementById("poder")?.classList.toggle("escondido", !j.h.fogo);
  document.querySelector(".tecla.fogo")?.classList.toggle("escondido", !j.h.fogo);

  // cartões de fim de fase / de jogo, depois de um instante
  if (pausado) return;
  if (j.estado === "jogando" || j.estado === "morrendo") {
    desdeFim = 0;
    if (estadoMostrado !== "jogando") { estadoMostrado = "jogando"; esconderCartao(); }
    return;
  }
  desdeFim += dt;
  if (desdeFim < 0.8 || estadoMostrado === j.estado) return;
  estadoMostrado = j.estado;
  guardarProgresso(j);
  const placar = `Pontos: <b>${j.pontos}</b> · Moedas: <b>${j.moedas}</b>`;
  if (j.estado === "venceuFase") cartao("Fase completa!", placar, `<button class="botao destaque" data-a="proxima">Próxima fase</button>`);
  else if (j.estado === "fimDeJogo") cartao("Fim de jogo", placar, `<button class="botao destaque" data-a="denovo">Tentar de novo</button>`);
  else cartao("Você zerou! 🎉", `O Osmário atravessou a cidade inteira.<br>${placar}`, `<button class="botao destaque" data-a="inicio">Jogar de novo</button>`);
}

// ---------------- cliques ----------------

app.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-a]");
  if (!el || el.disabled) return;
  el.blur(); // senão a barra de espaço "clica" no botão de novo
  switch (el.dataset.a) {
    case "jogar": comecar(Number(el.dataset.f)); break;
    case "menu": sair(); break;
    case "pausa": alternarPausa(); break;
    case "continuar": alternarPausa(); break;
    case "som": alternarSom(); break;
    case "controle": usarControle(el.dataset.v === "stick" ? "stick" : "botoes"); desenharMenu(); break;
    case "trocar-controle": usarControle(controle === "stick" ? "botoes" : "stick"); toques.clear(); cartaoDePausa(); break;
    case "proxima": jogo?.proximaFase(); esconderCartao(); break;
    case "denovo": if (jogo) { jogo.novoJogo(jogo.numero); esconderCartao(); } break;
    case "inicio": jogo?.novoJogo(0); esconderCartao(); break;
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (jogo && !pausado && jogo.estado === "jogando") alternarPausa(); return; }
  void verificarVersao();
  if (jogo) void pedirTrava();
});

// ---------------- versão: celular guarda a página antiga ----------------

async function verificarVersao(): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}versao.json?t=${Date.now()}`, { cache: "no-store" });
    const v = String((await r.json()).v || "");
    if (!v || v === __VERSAO__ || document.querySelector(".nova-versao")) return;
    const u = new URL(location.href);
    u.searchParams.set("v", v);
    if (!jogo) { location.replace(u.toString()); return; }
    const b = document.createElement("button");
    b.className = "nova-versao";
    b.textContent = "Nova versão disponível — tocar para atualizar";
    b.onclick = () => location.replace(u.toString());
    document.body.appendChild(b);
  } catch { /* sem rede ou em desenvolvimento */ }
}
void verificarVersao();

// gancho para testes automáticos: só existe no modo de desenvolvimento (some no build)
if (import.meta.env.DEV) Object.defineProperty(window, "__osmario", { get: () => jogo });

desenharMenu();
