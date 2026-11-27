import { Mesa } from "./mesa.ts";
import { Anfitriao, Convidado, normalizarPalavra, palavraAleatoria, type Msg } from "./rede.ts";
import { ROTULO, SIMBOLO, melhorArranjo, type Carta, type Vista } from "./regras.ts";

// ---------------- estado do aparelho ----------------

const app = document.getElementById("app") as HTMLElement;
const faixa = document.getElementById("faixa") as HTMLElement;
const toast = document.getElementById("toast") as HTMLElement;

function lerUid(): string {
  let u = localStorage.getItem("pife-uid");
  if (!u) {
    u = (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 32);
    localStorage.setItem("pife-uid", u);
  }
  return u;
}
const uid = lerUid();
let nome = localStorage.getItem("pife-nome") || "";

type Tela = "menu" | "conectando" | "sala" | "jogo";
let tela: Tela = "menu";
let mesa: Mesa | null = null; // só existe no aparelho do anfitrião (e no jogo contra bots)
let anf: Anfitriao | null = null;
let conv: Convidado | null = null;
let giro = 0;
let palavraSala = "";
let quantos = 4;
let erroMenu = "";
let textoConexao = "";
let ultimaSala: { jogadores: { nome: string; conectado: boolean; eu: boolean; host: boolean }[] } | null = null;
let vista: Vista | null = null;
let ordem: number[] = []; // ids da minha mão na ordem em que quero ver
let novas = new Set<number>(); // carta recém-comprada (destacada)
let selecionada = -1;
let rodadaVista = 0;
let avisoVisto = -1;
let eraMinhaVez = false;
let arrasto: { id: number; x: number; y: number; movendo: boolean } | null = null;
let trava: WakeLockSentinel | null = null;
let chatAberto = false; // gaveta do chat no celular
let naoLidas = 0;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// ---------------- ligação mesa <-> tela <-> rede ----------------

function receber(m: Msg): void {
  if (m.t === "sala") {
    ultimaSala = m as unknown as NonNullable<typeof ultimaSala>;
    vista = null;
    tela = "sala";
    desenhar();
  } else if (m.t === "estado") {
    const v = m as unknown as Vista;
    if (tela !== "jogo" || v.rodada !== rodadaVista) {
      ordem = organizar(v.mao);
      novas = new Set();
      selecionada = -1;
      avisoVisto = -1;
      rodadaVista = v.rodada;
    } else {
      // mantém a minha ordem; a carta nova entra no fim, destacada
      const tenho = new Set(v.mao.map((c) => c.id));
      const chegaram = v.mao.filter((c) => !ordem.includes(c.id)).map((c) => c.id);
      ordem = [...ordem.filter((id) => tenho.has(id)), ...chegaram];
      if (chegaram.length) novas = new Set(chegaram);
      else if (v.mao.length <= 9) novas = new Set();
    }
    vista = v;
    tela = "jogo";
    desenhar();
  } else if (m.t === "chat") {
    adicionarChat(m);
  } else if (m.t === "cheia") {
    sairParaMenu(String(m.motivo || "Não foi possível entrar."));
  } else if (m.t === "versao") {
    sairParaMenu("O anfitrião está com outra versão do jogo. Atualize a página e tente de novo.");
  }
}

function criarMesa(): Mesa {
  const m = new Mesa((dest, msg) => {
    if (dest === uid) receber(msg);
    else anf?.enviar(dest, msg);
  }, uid);
  mesa = m;
  giro = window.setInterval(() => m.tick(), 250);
  return m;
}

function agir(m: Msg): void {
  if (mesa) mesa.receber(uid, m);
  else conv?.enviar(m);
}

function fecharTudo(): void {
  clearInterval(giro);
  anf?.fechar();
  conv?.fechar();
  anf = null;
  conv = null;
  mesa = null;
  vista = null;
  ultimaSala = null;
  rodadaVista = 0;
  faixa.classList.add("escondido");
  toast.innerHTML = "";
}

function sairParaMenu(erro = ""): void {
  fecharTudo();
  erroMenu = erro;
  tela = "menu";
  desenhar();
}

function guardarNome(): void {
  const el = document.getElementById("nome") as HTMLInputElement | null;
  if (el) nome = el.value.trim().slice(0, 16);
  if (!nome) nome = "Jogador";
  localStorage.setItem("pife-nome", nome);
}

function jogarContraBots(n: number): void {
  guardarNome();
  fecharTudo();
  const m = criarMesa();
  m.entrar(uid, nome);
  m.iniciar(n);
}

function criarSala(tentativa = 0): void {
  guardarNome();
  fecharTudo();
  palavraSala = palavraAleatoria();
  const m = criarMesa();
  tela = "sala";
  desenhar();
  anf = new Anfitriao(palavraSala, {
    aoAbrir: () => { m.entrar(uid, nome); },
    aoErro: (tipo) => {
      if (tipo === "palavra-em-uso" && tentativa < 5) criarSala(tentativa + 1);
      else sairParaMenu("Não consegui abrir a sala (" + tipo + "). Verifique a internet.");
    },
    aoEntrou: (l) => { m.entrar(l.uid, l.nome); },
    aoSaiu: (l) => { m.sair(l.uid); },
    aoMensagem: (l, msg) => { m.receber(l.uid, msg); },
  });
}

function entrarNaSala(): void {
  guardarNome();
  const p = normalizarPalavra((document.getElementById("palavra") as HTMLInputElement | null)?.value ?? "");
  if (!p) { erroMenu = "Digite a palavra da sala."; desenhar(); return; }
  fecharTudo();
  palavraSala = p;
  tela = "conectando";
  textoConexao = "Conectando...";
  desenhar();
  conv = new Convidado(p, uid, nome, {
    aoConectar: () => { faixa.classList.add("escondido"); },
    aoDesconectar: () => { faixa.textContent = "Conexão perdida. Reconectando..."; faixa.classList.remove("escondido"); },
    aoMensagem: receber,
    aoEstado: (t) => { textoConexao = t; if (tela === "conectando") desenhar(); },
  });
}

// ---------------- telas ----------------

async function pedirTrava(): Promise<void> {
  try {
    if ("wakeLock" in navigator && !trava) {
      trava = await navigator.wakeLock.request("screen");
      trava.addEventListener("release", () => { trava = null; });
    }
  } catch { /* sem permissão ou sem suporte */ }
}

function desenhar(): void {
  // o chat existe na sala de espera e na partida
  const comChat = tela === "sala" || tela === "jogo";
  document.body.classList.toggle("com-chat", comChat);
  $("chat").classList.toggle("escondido", !comChat);
  $("bt-chat").classList.toggle("escondido", !comChat);
  if (!comChat) limparChat();
  if (tela === "jogo") void pedirTrava();
  else { void trava?.release(); trava = null; eraMinhaVez = false; }
  if (tela === "menu") desenharMenu();
  else if (tela === "conectando") desenharConectando();
  else if (tela === "sala") desenharSala();
  else if (vista) desenharJogo(vista);
}

function desenharMenu(): void {
  const sala = new URLSearchParams(location.search).get("sala") ?? "";
  app.innerHTML = `
  <div class="tela">
    <div class="logo">Pife</div>
    <div class="sub">Pife online: 9 cartas na mão, três jogos para bater. De 2 a 4 pessoas, com bots para completar a mesa.</div>
    <div class="bloco">
      <h2>Seu nome</h2>
      <input type="text" id="nome" maxlength="16" placeholder="Como você quer ser chamado" value="${esc(nome)}" autocomplete="off" />
    </div>
    <div class="bloco">
      <h2>Jogar contra bots</h2>
      <div class="linha">
        <button class="botao destaque" data-a="bots" data-n="2">1 bot</button>
        <button class="botao destaque" data-a="bots" data-n="3">2 bots</button>
        <button class="botao destaque" data-a="bots" data-n="4">3 bots</button>
      </div>
    </div>
    <div class="bloco">
      <h2>Jogar com amigos</h2>
      <button class="botao ouro" data-a="criar">Criar sala</button>
      <div class="linha">
        <input type="text" id="palavra" maxlength="16" placeholder="palavra da sala" value="${esc(sala)}" autocomplete="off" autocapitalize="off" />
        <button class="botao destaque" data-a="entrar" style="flex:0 0 auto">Entrar</button>
      </div>
    </div>
    <div class="erro">${esc(erroMenu)}</div>
    <details>
      <summary>Como jogar</summary>
      <ul>
        <li>Dois baralhos, <b>9 cartas</b> para cada um.</li>
        <li>Na sua vez: compre do <b>monte</b> ou pegue a carta do <b>lixo</b>, e depois descarte uma.</li>
        <li>Forme <b>jogos</b> de 3 ou mais cartas: <b>sequência</b> do mesmo naipe (o Ás vale antes do 2 ou depois do K) ou <b>trinca</b> do mesmo valor em naipes diferentes.</li>
        <li><b>Bate</b> quem colocar as 9 cartas em jogos. As cartas que já formam jogo ficam com uma faixa colorida.</li>
        <li>Se o descarte de alguém completa a sua mão, você pode pegar e bater mesmo fora da vez.</li>
        <li>Arraste as cartas para arrumar a mão, ou toque em <b>Organizar</b>.</li>
      </ul>
    </details>
    <a class="voltar" href="../index.html">← todos os jogos</a>
  </div>`;
}

function desenharConectando(): void {
  app.innerHTML = `
  <div class="tela">
    <div class="logo">Pife</div>
    <div class="bloco">
      <h2>Sala</h2>
      <div class="palavra">${esc(palavraSala)}</div>
      <div class="sub">${esc(textoConexao)}</div>
      <button class="botao" data-a="menu">Cancelar</button>
    </div>
  </div>`;
}

function desenharSala(): void {
  const s = ultimaSala;
  const humanos = s ? s.jogadores.length : 0;
  const cabe = humanos <= quantos;
  const lista = s
    ? s.jogadores.map((j) => `<div class="item"><span>${esc(j.nome)}${j.eu ? " (você)" : ""}</span><span class="tag">${j.host ? "ANFITRIÃO" : j.conectado ? "" : "SEM CONEXÃO"}</span></div>`).join("")
    : `<div class="sub">Abrindo a sala...</div>`;
  app.innerHTML = `
  <div class="tela">
    <div class="logo">Pife</div>
    <div class="bloco">
      <h2>${mesa ? "Sua sala" : "Sala"}</h2>
      <div class="palavra">${esc(palavraSala)}</div>
      ${mesa ? `<div class="sub">Passe essa palavra para os amigos (em <b>Entrar</b>) ou copie o link.</div><button class="botao" data-a="copiar">Copiar link</button>` : ""}
    </div>
    <div class="bloco"><h2>Jogadores (${humanos}/4)</h2><div class="lista">${lista}</div></div>
    ${mesa ? `
    <div class="bloco">
      <h2>Quantos na mesa</h2>
      <div class="opcoes">${[2, 3, 4].map((n) => `<label><input type="radio" name="quantos" value="${n}" ${quantos === n ? "checked" : ""} /><b>${n}</b>jogadores</label>`).join("")}</div>
      <div class="sub">Lugares vazios são preenchidos por bots.</div>
      <button class="botao destaque" data-a="comecar" ${s && cabe ? "" : "disabled"}>Começar</button>
      ${s && !cabe ? `<div class="erro">Tem gente demais para essa mesa. Aumente o número de jogadores.</div>` : ""}
    </div>` : `<div class="sub">Aguardando o anfitrião começar a partida...</div>`}
    <button class="botao" data-a="menu">Sair da sala</button>
  </div>`;
}

// ---------------- a mesa de jogo ----------------

function cartaHtml(c: Carta, extra = "", attrs = ""): string {
  const verm = c.n === "O" || c.n === "C";
  return `<div class="carta ${verm ? "verm" : ""} ${extra}" ${attrs}><span class="canto">${ROTULO[c.r]}<br>${SIMBOLO[c.n]}</span><span class="grande">${SIMBOLO[c.n]}</span></div>`;
}

// jogos prontos primeiro, depois as soltas por naipe e valor
function organizar(mao: Carta[]): number[] {
  const a = melhorArranjo(mao);
  const soltas = [...a.soltas].sort((x, y) => x.n.localeCompare(y.n) || x.r - y.r);
  return [...a.jogos.flat(), ...soltas].map((c) => c.id);
}

function anunciar(texto: string, grito: boolean): void {
  const el = document.createElement("div");
  el.className = "aviso" + (grito ? " grito" : "");
  el.textContent = texto;
  toast.appendChild(el);
  while (toast.childElementCount > 2) toast.firstElementChild?.remove();
  setTimeout(() => el.remove(), 2100);
}

function desenharJogo(v: Vista): void {
  const minhaVez = v.vez === v.eu && (v.fase === "comprar" || v.fase === "descartar");
  const comprando = minhaVez && v.fase === "comprar";
  const descartando = minhaVez && v.fase === "descartar";
  if (!descartando || !v.mao.some((c) => c.id === selecionada)) selecionada = -1;
  const chamado = minhaVez || v.ofertaPraMim;
  if (chamado && !eraMinhaVez) { try { navigator.vibrate?.(v.ofertaPraMim ? [90, 60, 90] : 45); } catch { /* ignora */ } }
  eraMinhaVez = chamado;

  if (v.avisoId !== avisoVisto) {
    avisoVisto = v.avisoId;
    if (v.aviso && v.fase !== "fim") anunciar(v.aviso, false);
  }
  if (v.fase === "fim") toast.innerHTML = "";

  const adversarios = Array.from({ length: v.n - 1 }, (_, k) => (v.eu + k + 1) % v.n)
    .map((s) => `<div class="jogador ${v.vez === s && v.fase !== "fim" && v.fase !== "oferta" ? "vez" : ""}">
        <div class="nome">${esc(v.nomes[s])}${v.bots[s] ? " 🤖" : ""}</div>
        <div class="fila">${Array.from({ length: v.qtd[s] }, () => '<div class="carta verso"></div>').join("")}</div>
        <div class="info" title="cartas na mão e rodadas vencidas">${v.qtd[s]} cartas · 🏆${v.vitorias[s]}</div>
      </div>`)
    .join("");

  const topo = v.lixo;
  const podePegar = comprando && !!topo;

  let status = "";
  let acoes = "";
  if (v.ofertaPraMim && topo) {
    status = `O <b>${ROTULO[topo.r]}${SIMBOLO[topo.n]}</b> descartado completa a sua mão!`;
    acoes = `<button class="botao ouro bate" data-a="bater">Bater!</button><button class="botao" data-a="passar">Passar</button>`;
  } else if (v.fase === "oferta") {
    status = "Um instante...";
  } else if (comprando) {
    status = v.possoBater ? "Sua mão está pronta: <b>bata!</b>" : "Sua vez: compre do <b>monte</b> ou pegue o <b>lixo</b>";
  } else if (descartando) {
    status = v.possoBater ? "Você pode <b>bater!</b>" : selecionada >= 0 ? "Toque de novo na carta (ou em Descartar)" : "Escolha a carta para <b>descartar</b>";
  } else if (v.fase !== "fim") {
    status = `Vez de <b>${esc(v.nomes[v.vez])}</b>`;
  }
  if (minhaVez && v.possoBater) acoes += `<button class="botao ouro bate" data-a="bater">Bater!</button>`;
  if (descartando) acoes += `<button class="botao destaque" data-a="descartar" ${selecionada >= 0 && selecionada !== v.doLixo ? "" : "disabled"}>Descartar</button>`;
  acoes += `<button class="botao" data-a="organizar">Organizar</button>`;

  // faixas coloridas nas cartas que já formam jogo
  const porId = new Map(v.mao.map((c) => [c.id, c]));
  const grupo = new Map<number, number>();
  melhorArranjo(ordem.map((id) => porId.get(id)!).filter(Boolean)).jogos.forEach((g, k) => g.forEach((c) => grupo.set(c.id, k % 3)));
  const mao = ordem
    .map((id) => porId.get(id))
    .filter((c): c is Carta => !!c)
    .map((c) => {
      const classes = [grupo.has(c.id) ? `jogo-${grupo.get(c.id)}` : "", c.id === selecionada ? "sel" : "", novas.has(c.id) && c.id !== selecionada ? "nova" : ""].join(" ");
      return cartaHtml(c, classes, `data-id="${c.id}"`);
    })
    .join("");

  let fim = "";
  if (v.fase === "fim") {
    const ganhei = v.vencedor === v.eu;
    const jogos = (v.jogos ?? []).map((g) => `<div class="grupo">${g.map((c) => cartaHtml(c)).join("")}</div>`).join("");
    const placar = v.nomes.map((n, s) => `${esc(n)}: <b>${v.vitorias[s]}</b>`).join(" · ");
    fim = `<div class="fim ${ganhei ? "" : "perdeu"}">
      <h1>${ganhei ? "Você bateu! 🎉" : `${esc(v.nomes[v.vencedor])} bateu`}</h1>
      <div class="jogos">${jogos}</div>
      <div class="placar">${placar}</div>
      ${mesa ? `<button class="botao destaque" data-a="proxima">Próxima rodada</button><button class="botao" data-a="voltarsala">Voltar à sala</button>` : `<div class="sub">Aguardando o anfitrião...</div>`}
      <button class="botao" data-a="menu">Sair</button>
    </div>`;
  }

  app.innerHTML = `
  <div id="jogo">
    <div class="topo">
      <button class="sair" data-a="sair">Sair</button>
      <div class="rodada" title="rodada e suas vitórias">Rodada <b>${v.rodada}</b> · 🏆 <b>${v.vitorias[v.eu]}</b></div>
    </div>
    <div class="mesa">
      <div class="adversarios">${adversarios}</div>
      <div class="centro">
        <button class="pilha monte" data-a="monte" ${comprando ? "" : "disabled"}><div class="carta verso"></div><span>Monte ${v.noMonte}</span></button>
        <button class="pilha" data-a="lixo" ${podePegar ? "" : "disabled"}>${topo ? cartaHtml(topo) : '<div class="vazio"></div>'}<span>Lixo</span></button>
      </div>
    </div>
    <div class="base">
      <div class="status ${minhaVez || v.ofertaPraMim ? "sua" : ""}">${status}</div>
      <div class="acoes">${acoes}</div>
      <div class="mao">${mao}</div>
    </div>
    ${fim}
  </div>`;
}

// ---------------- chat geral ----------------

const painelFixo = (): boolean => matchMedia("(min-width: 900px) and (min-height: 500px)").matches;

function atualizarBadge(): void {
  const b = $("chat-badge");
  b.textContent = naoLidas > 9 ? "9+" : String(naoLidas);
  b.classList.toggle("escondido", naoLidas === 0);
}

function adicionarChat(msg: Msg): void {
  const log = $("chat-log");
  const meu = msg.meu === true;
  const div = document.createElement("div");
  div.className = "msg" + (meu ? " eu" : "");
  const quem = document.createElement("b");
  quem.textContent = String(msg.nome); // textContent: o que os outros digitam nunca vira HTML
  div.append(quem, document.createTextNode(" " + String(msg.texto)));
  const noFim = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.appendChild(div);
  while (log.childElementCount > 100) log.firstElementChild?.remove();
  if (noFim || meu) log.scrollTop = log.scrollHeight;
  if (!meu && !painelFixo() && !chatAberto) { naoLidas++; atualizarBadge(); }
}

function limparChat(): void {
  $("chat-log").innerHTML = "";
  naoLidas = 0;
  chatAberto = false;
  $("chat").classList.remove("aberto");
  atualizarBadge();
}

function abrirChat(abrir: boolean): void {
  chatAberto = abrir;
  $("chat").classList.toggle("aberto", abrir);
  if (!abrir) return;
  naoLidas = 0;
  atualizarBadge();
  const log = $("chat-log");
  log.scrollTop = log.scrollHeight;
  $<HTMLInputElement>("chat-input").focus();
}

$("bt-chat").addEventListener("click", () => abrirChat(!chatAberto));
$("chat-fechar").addEventListener("click", () => abrirChat(false));
$("chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const campo = $<HTMLInputElement>("chat-input");
  const texto = campo.value.trim();
  if (!texto) return;
  agir({ t: "chat", texto });
  campo.value = "";
});

// ---------------- cliques ----------------

app.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  switch (el.dataset.a) {
    case "bots": jogarContraBots(Number(el.dataset.n)); break;
    case "criar": criarSala(); break;
    case "entrar": entrarNaSala(); break;
    case "menu": sairParaMenu(); break;
    case "sair": if (confirm("Sair da partida?")) sairParaMenu(); break;
    case "comecar": agir({ t: "iniciar", n: quantos }); break;
    case "voltarsala": agir({ t: "sala" }); break;
    case "proxima": agir({ t: "proxima" }); break;
    case "copiar": {
      const link = `${location.origin}${location.pathname}?sala=${encodeURIComponent(palavraSala)}`;
      void navigator.clipboard?.writeText(link).then(() => { el.textContent = "Link copiado!"; });
      break;
    }
    case "monte": agir({ t: "comprar", de: "monte" }); break;
    case "lixo": agir({ t: "comprar", de: "lixo" }); break;
    case "bater": agir({ t: "bater" }); break;
    case "passar": agir({ t: "passar" }); break;
    case "descartar": if (selecionada >= 0) agir({ t: "descartar", id: selecionada }); break;
    case "organizar": if (vista) { ordem = organizar(vista.mao); desenhar(); } break;
  }
});

// mão: toque seleciona (e o segundo toque descarta); arrastar muda a carta de lugar
app.addEventListener("pointerdown", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".mao .carta");
  if (el) arrasto = { id: Number(el.dataset.id), x: e.clientX, y: e.clientY, movendo: false };
});
addEventListener("pointermove", (e) => {
  if (!arrasto) return;
  if (!arrasto.movendo && Math.hypot(e.clientX - arrasto.x, e.clientY - arrasto.y) > 10) arrasto.movendo = true;
  if (arrasto.movendo) app.querySelector(`.mao .carta[data-id="${arrasto.id}"]`)?.classList.add("arrasta");
});
addEventListener("pointercancel", () => { arrasto = null; });
addEventListener("pointerup", (e) => {
  const a = arrasto;
  arrasto = null;
  if (!a || !vista) return;
  if (a.movendo) {
    const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(".mao .carta");
    const destino = alvo ? Number(alvo.dataset.id) : -1;
    if (destino >= 0 && destino !== a.id) {
      const para = ordem.indexOf(destino);
      ordem = ordem.filter((id) => id !== a.id);
      ordem.splice(para, 0, a.id);
    }
    desenhar();
    return;
  }
  const minhaVez = vista.vez === vista.eu && vista.fase === "descartar";
  if (!minhaVez) return;
  if (selecionada === a.id) {
    if (a.id !== vista.doLixo) agir({ t: "descartar", id: a.id });
  } else {
    selecionada = a.id;
    desenhar();
    if (a.id === vista.doLixo) anunciar("Você acabou de pegar essa do lixo: descarte outra", false);
  }
});

app.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.name === "quantos") { quantos = Number(el.value); desenhar(); }
});

app.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.target as HTMLElement).id === "palavra") entrarNaSala();
});

// ---------------- versão: celular guarda a página antiga ----------------

function irParaVersao(v: string): void {
  const u = new URL(location.href);
  u.searchParams.set("v", v);
  location.replace(u.toString());
}

async function verificarVersao(): Promise<void> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}versao.json?t=${Date.now()}`, { cache: "no-store" });
    const v = String((await r.json()).v || "");
    if (!v || v === __VERSAO__) return;
    if (tela === "menu") { irParaVersao(v); return; }
    if (document.querySelector(".nova-versao")) return;
    const b = document.createElement("button");
    b.className = "nova-versao";
    b.textContent = "Nova versão disponível — tocar para atualizar";
    b.onclick = () => irParaVersao(v);
    document.body.appendChild(b);
  } catch { /* sem rede ou sem versao.json (desenvolvimento) */ }
}
void verificarVersao();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  void verificarVersao();
  if (tela === "jogo") void pedirTrava();
});
setInterval(() => void verificarVersao(), 5 * 60 * 1000);

desenhar();
