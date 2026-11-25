import { Mesa } from "./mesa.ts";
import { Anfitriao, Convidado, normalizarPalavra, palavraAleatoria, type Msg } from "./rede.ts";
import { GRITO, SIMBOLO, proxValor, timeDe, type Carta, type JogadaVista, type Vista } from "./regras.ts";
import { SINAIS } from "./sinais.ts";

// ---------------- estado do aparelho ----------------

const app = document.getElementById("app") as HTMLElement;
const faixa = document.getElementById("faixa") as HTMLElement;
const toast = document.getElementById("toast") as HTMLElement;

// identidade fixa do jogador neste navegador: é por ela que ele volta ao mesmo lugar depois de cair
function lerUid(): string {
  let u = localStorage.getItem("truco-uid");
  if (!u) {
    u = (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 32);
    localStorage.setItem("truco-uid", u);
  }
  return u;
}
const uid = lerUid();
let nome = localStorage.getItem("truco-nome") || "";

type Tela = "menu" | "conectando" | "sala" | "jogo";
let tela: Tela = "menu";
let mesa: Mesa | null = null; // só existe no aparelho do anfitrião (e no jogo contra bots)
let anf: Anfitriao | null = null;
let conv: Convidado | null = null;
let giro = 0;
let palavraSala = "";
let modoEscolhido: 2 | 4 = 4;
let erroMenu = "";
let textoConexao = "";
let ultimaSala: { jogadores: { nome: string; conectado: boolean; eu: boolean; host: boolean }[]; souHost: boolean } | null = null;
let vista: Vista | null = null;
let avisoVisto = -1;
const toque = matchMedia("(pointer: coarse)").matches; // no celular o 1º toque só seleciona a carta (evita jogar sem querer)
let selecionada = -1;
let eraMinhaVez = false;
let eraPedido = false;
let trava: WakeLockSentinel | null = null;
let escondendo = false; // a próxima carta vai virada para baixo
let menuSinais = false;
const sinais = new Map<number, { id: string; ate: number }>(); // sinal em andamento de cada assento
let timerSinais = 0;

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// ---------------- ligação mesa <-> tela <-> rede ----------------

function receberDoServidor(m: Msg): void {
  if (m.t === "sala") {
    ultimaSala = m as unknown as NonNullable<typeof ultimaSala>;
    vista = null;
    tela = "sala";
    desenhar();
  } else if (m.t === "estado") {
    if (tela !== "jogo") avisoVisto = -1;
    vista = m as unknown as Vista;
    tela = "jogo";
    desenhar();
  } else if (m.t === "sinal") {
    const def = SINAIS.find((x) => x.id === m.s);
    if (!def || !vista) return;
    const seat = Number(m.seat);
    sinais.set(seat, { id: def.id, ate: Date.now() + 2600 });
    if (m.vis === "parceiro") vibrar(30);
    if (m.vis === "flagra") anunciar(`👀 Você viu ${vista.nomes[seat]} ${def.texto}!`, false);
    desenhar();
    clearTimeout(timerSinais);
    timerSinais = window.setTimeout(desenhar, 2700); // some a bolha
  } else if (m.t === "cheia") {
    sairParaMenu(String(m.motivo || "Não foi possível entrar."));
  } else if (m.t === "versao") {
    sairParaMenu("O anfitrião está com outra versão do jogo. Atualize a página e tente de novo.");
  }
}

function criarMesa(): Mesa {
  const m = new Mesa((dest, msg) => {
    if (dest === uid) receberDoServidor(msg);
    else anf?.enviar(dest, msg);
  }, uid);
  mesa = m;
  giro = window.setInterval(() => m.tick(), 250);
  return m;
}

// ação do jogador deste aparelho: vai direto na mesa (anfitrião) ou pela rede (convidado)
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
  faixa.classList.add("escondido");
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
  localStorage.setItem("truco-nome", nome);
}

function jogarContraBots(n: 2 | 4): void {
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
  ultimaSala = null;
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
  const el = document.getElementById("palavra") as HTMLInputElement | null;
  const p = normalizarPalavra(el?.value ?? "");
  if (!p) { erroMenu = "Digite a palavra da sala."; desenhar(); return; }
  fecharTudo();
  palavraSala = p;
  tela = "conectando";
  textoConexao = "Conectando...";
  desenhar();
  conv = new Convidado(p, uid, nome, {
    aoConectar: () => { faixa.classList.add("escondido"); },
    aoDesconectar: () => { faixa.textContent = "Conexão perdida. Reconectando..."; faixa.classList.remove("escondido"); },
    aoMensagem: receberDoServidor,
    aoEstado: (t) => { textoConexao = t; if (tela === "conectando") desenhar(); },
  });
}

// ---------------- desenho ----------------

// mantém a tela acesa durante a partida (celular apagando no meio do jogo derruba a conexão)
async function pedirTrava(): Promise<void> {
  try {
    if ("wakeLock" in navigator && !trava) {
      trava = await navigator.wakeLock.request("screen");
      trava.addEventListener("release", () => { trava = null; });
    }
  } catch { /* sem permissão ou sem suporte: segue sem */ }
}

function vibrar(padrao: number | number[]): void {
  try { navigator.vibrate?.(padrao); } catch { /* ignora */ }
}

function desenhar(): void {
  if (tela === "jogo") void pedirTrava();
  else { void trava?.release(); trava = null; eraMinhaVez = false; eraPedido = false; selecionada = -1; escondendo = false; menuSinais = false; sinais.clear(); }
  if (tela === "menu") desenharMenu();
  else if (tela === "conectando") desenharConectando();
  else if (tela === "sala") desenharSala();
  else if (vista) desenharJogo(vista);
}

function desenharMenu(): void {
  const sala = new URLSearchParams(location.search).get("sala") ?? "";
  app.innerHTML = `
  <div class="tela">
    <div class="logo">Truco</div>
    <div class="sub">Truco paulista online: 1x1 ou em duplas, com amigos pelo celular e bots para completar a mesa.</div>
    <div class="bloco">
      <h2>Seu nome</h2>
      <input type="text" id="nome" maxlength="16" placeholder="Como você quer ser chamado" value="${esc(nome)}" autocomplete="off" />
    </div>
    <div class="bloco">
      <h2>Jogar contra bots</h2>
      <div class="linha">
        <button class="botao destaque" data-a="bots2">1x1</button>
        <button class="botao destaque" data-a="bots4">Duplas (2x2)</button>
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
      <summary>Regras rápidas</summary>
      <ul>
        <li>Baralho de 40 cartas (sem 8, 9 e 10). Cada um recebe 3 cartas e vira-se uma carta: a <b>manilha</b> é a seguinte à vira.</li>
        <li>Força: 4 5 6 7 Q J K A 2 3, e as manilhas por cima (paus &gt; copas &gt; espadas &gt; ouros).</li>
        <li>Vence a mão quem ganhar 2 de 3 vazas. Empate na 1ª: a 2ª decide; empate nas seguintes: vale a 1ª.</li>
        <li>A mão vale 1 ponto. Peça <b>truco</b> (3), <b>seis</b>, <b>nove</b> e <b>doze</b>; o adversário aceita, corre ou aumenta.</li>
        <li>Da 2ª vaza em diante dá para <b>esconder a carta</b>: ela vai virada, não vale nada (perde de qualquer carta aberta) e ninguém vê qual era.</li>
        <li>No 2x2 com parceiro de verdade, use o <b>🤫</b> para mandar sinais (piscar, língua, ombro...). O parceiro sempre vê; os adversários podem pegar no flagra.</li>
        <li>Partida até 12 pontos. Com 11 pontos é a <b>mão de onze</b>: vale 3 e não tem truco. Os dois com 11: <b>mão de ferro</b>.</li>
      </ul>
    </details>
    <a class="voltar" href="../index.html">← todos os jogos</a>
  </div>`;
}

function desenharConectando(): void {
  app.innerHTML = `
  <div class="tela">
    <div class="logo">Truco</div>
    <div class="bloco">
      <h2>Sala</h2>
      <div class="palavra">${esc(palavraSala)}</div>
      <div class="sub">${esc(textoConexao)}</div>
      <button class="botao" data-a="menu">Cancelar</button>
    </div>
  </div>`;
}

function desenharSala(): void {
  const link = `${location.origin}${location.pathname}?sala=${encodeURIComponent(palavraSala)}`;
  const s = ultimaSala;
  const souHost = !!mesa;
  const lista = s
    ? s.jogadores
        .map((j) => `<div class="item"><span>${esc(j.nome)}${j.eu ? " (você)" : ""}</span><span class="tag">${j.host ? "ANFITRIÃO" : j.conectado ? "" : "SEM CONEXÃO"}</span></div>`)
        .join("")
    : `<div class="sub">Abrindo a sala...</div>`;
  const humanos = s ? s.jogadores.length : 0;
  const cabe = humanos <= modoEscolhido;
  app.innerHTML = `
  <div class="tela">
    <div class="logo">Truco</div>
    <div class="bloco">
      <h2>${souHost ? "Sua sala" : "Sala"}</h2>
      <div class="palavra">${esc(palavraSala)}</div>
      ${souHost ? `<div class="sub">Passe essa palavra para os amigos (em <b>Entrar</b>) ou copie o link.</div>
      <button class="botao" data-a="copiar" data-link="${esc(link)}">Copiar link</button>` : ""}
    </div>
    <div class="bloco">
      <h2>Jogadores (${humanos}/4)</h2>
      <div class="lista">${lista}</div>
    </div>
    ${souHost ? `
    <div class="bloco">
      <h2>Modo de jogo</h2>
      <div class="opcoes">
        <label><input type="radio" name="modo" value="2" ${modoEscolhido === 2 ? "checked" : ""} /><b>1x1</b>até 2 pessoas</label>
        <label><input type="radio" name="modo" value="4" ${modoEscolhido === 4 ? "checked" : ""} /><b>Duplas 2x2</b>até 4 pessoas</label>
      </div>
      <div class="sub">Lugares vazios são preenchidos por bots. Em duplas, cada um senta na ordem em que entrou: o 1º e o 3º jogadores são parceiros contra o 2º e o 4º.</div>
      <button class="botao destaque" data-a="comecar" ${s && cabe ? "" : "disabled"}>Começar</button>
      ${s && !cabe ? `<div class="erro">Tem gente demais para o 1x1. Escolha duplas.</div>` : ""}
    </div>` : `<div class="sub">Aguardando o anfitrião começar a partida...</div>`}
    <button class="botao" data-a="menu">Sair da sala</button>
  </div>`;
}

function cartaHtml(c: Carta, manilha: string, extra = "", tag = "div", attrs = ""): string {
  const verm = c.n === "O" || c.n === "C";
  const s = SIMBOLO[c.n];
  return `<${tag} class="carta ${verm ? "verm" : ""} ${c.r === manilha ? "manilha" : ""} ${extra}" ${attrs}><span class="canto">${c.r}<br>${s}</span><span class="grande">${s}</span></${tag}>`;
}

// a carta de uma jogada na mesa: virada para baixo se foi escondida (o dono ainda vê a dele, apagada)
function cartaDaMesa(j: JogadaVista, manilha: string): string {
  if (!j.coberta && j.carta) return cartaHtml(j.carta, manilha);
  if (j.carta) return cartaHtml(j.carta, manilha, "coberta-minha");
  return `<div class="carta verso coberta"></div>`;
}

function bolha(seat: number, extra = ""): string {
  const x = sinais.get(seat);
  const def = x && Date.now() < x.ate ? SINAIS.find((d) => d.id === x.id) : undefined;
  return def ? `<span class="sinal ${extra}" title="${esc(def.texto)}">${def.emoji}</span>` : "";
}

function versos(qtd: number): string {
  return Array.from({ length: qtd }, () => `<div class="carta verso"></div>`).join("");
}

function desenharJogo(v: Vista): void {
  const meu = timeDe(v.eu);
  const nos = v.pontos[meu];
  const eles = v.pontos[1 - meu];
  const rel = (s: number): number => (s - v.eu + v.n) % v.n;
  const pos = (s: number): string => (v.n === 2 ? (rel(s) === 0 ? "baixo" : "cima") : ["baixo", "esq", "cima", "dir"][rel(s)]);
  const jogando = v.fase === "jogando";
  const minhaVez = jogando && v.vez === v.eu && !v.pedido && v.decisao11 === null;

  // avisa no celular quando a vez chega ou quando pedem truco
  const pedidoPraMim = !!v.pedido && timeDe(v.pedido.de) !== meu;
  if (minhaVez && !eraMinhaVez) vibrar(45);
  if (pedidoPraMim && !eraPedido) vibrar([90, 60, 90]);
  eraMinhaVez = minhaVez;
  eraPedido = pedidoPraMim;
  if (!minhaVez || selecionada >= v.mao.length) selecionada = -1;
  if (!v.podeEsconder) escondendo = false;

  // novo aviso do jogo (truco, correu, vaza...)
  if (v.avisoId !== avisoVisto) {
    avisoVisto = v.avisoId;
    if (v.aviso && v.fase !== "fim") anunciar(v.aviso, /(TRUCO|SEIS|NOVE|DOZE)!/.test(v.aviso));
  }
  if (v.fase === "fim") toast.innerHTML = ""; // o resultado da partida não pode ficar atrás de um aviso

  const outros = Array.from({ length: v.n }, (_, s) => s)
    .filter((s) => s !== v.eu)
    .map((s) => {
      const lado = timeDe(s) === meu ? (v.n === 4 ? "parceiro" : "adversario") : "adversario";
      const vez = jogando && v.vez === s && !v.pedido && v.decisao11 === null;
      return `<div class="jogador pos-${pos(s)} ${lado} ${vez ? "vez" : ""}">
        ${bolha(s)}
        <div class="nome">${esc(v.nomes[s])}${v.bots[s] ? " 🤖" : ""}${v.dador === s ? '<span class="dador">D</span>' : ""}</div>
        <div class="fila">${versos(v.qtd[s])}</div>
      </div>`;
    })
    .join("");

  const vencedorVaza = v.fase === "vazaFechada" ? v.ultimaVaza?.vencedor ?? -1 : -1;
  const cartasMesa = v.mesa
    .map((j) => `<div class="slot ${pos(j.seat)} ${j.seat === vencedorVaza ? "vence" : ""}">${cartaDaMesa(j, v.manilha)}</div>`)
    .join("");

  const vazas = v.vazas.map((r) => `<i class="${r === -1 ? "emp" : r === meu ? "nos" : "eles"}"></i>`).join("");
  const banner = v.fase === "fimMao" ? `<div class="faixa-mao">${esc(v.resumo)}</div>` : "";

  // o que o jogador pode fazer agora
  let status = "";
  let acoes = "";
  if (v.decisao11 !== null) {
    if (v.decisao11 === meu) {
      status = `<b>Mão de onze!</b> Veja as cartas${v.n === 4 ? " (e as do parceiro)" : ""} e decida.`;
      acoes = `<button class="botao destaque" data-a="onze-j">Jogar (vale 3)</button><button class="botao perigo" data-a="onze-c">Correr (1 p/ eles)</button>`;
    } else {
      status = "Os adversários estão decidindo a mão de onze...";
    }
  } else if (v.pedido) {
    const quem = v.nomes[v.pedido.de];
    if (timeDe(v.pedido.de) !== meu) {
      status = `<b>${esc(quem)}</b> pediu <b>${GRITO[v.pedido.valor]}</b> (a mão passa a valer ${v.pedido.valor}).`;
      acoes = `<button class="botao destaque" data-a="resp-aceitar">Aceitar</button>
               <button class="botao perigo" data-a="resp-correr">Correr</button>
               ${v.podeAumentarResp ? `<button class="botao ouro" data-a="resp-aumentar">${GRITO[proxValor(v.pedido.valor)]}!</button>` : ""}`;
    } else {
      status = `Você pediu <b>${GRITO[v.pedido.valor]}</b>. Aguardando resposta...`;
    }
  } else if (jogando) {
    status = minhaVez ? (toque ? (selecionada >= 0 ? "Toque de novo na carta para jogar" : "Sua vez: toque na carta que quer jogar") : "Sua vez: escolha uma carta") : `Vez de <b>${esc(v.nomes[v.vez])}</b>`;
    if (minhaVez && escondendo) status = "<b>Escondendo:</b> a próxima carta vai virada e não vale nada";
    if (minhaVez && v.podeEsconder) acoes += `<button class="botao ${escondendo ? "ouro" : ""}" data-a="esconder">${escondendo ? "Escondendo ✓" : "Esconder carta"}</button>`;
    if (minhaVez && v.podeTruco) acoes += `<button class="botao ouro grito" data-a="truco">${GRITO[v.proxValor]}!</button>`;
  } else if (v.fase === "vazaFechada") {
    status = v.ultimaVaza && v.ultimaVaza.vencedor >= 0 ? `<b>${esc(v.nomes[v.ultimaVaza.vencedor])}</b> levou a vaza` : "Vaza empatada";
  }

  const mao = v.mao
    .map((c, i) => cartaHtml(c, v.manilha, toque && i === selecionada ? "sel" : "", "button", `data-a="jogar" data-i="${i}" ${minhaVez ? "" : "disabled"}`))
    .join("");
  const temSinais = v.n === 4 && !v.bots[(v.eu + 2) % 4] && v.fase !== "fim"; // só com um parceiro de verdade
  const menu = temSinais
    ? `<div class="sinais">${menuSinais ? SINAIS.map((x) => `<button class="bt-sinal" data-a="sinal" data-s="${x.id}" title="${esc(x.texto)}">${x.emoji}</button>`).join("") : ""}<button class="bt-sinal principal ${menuSinais ? "aberto" : ""}" data-a="sinais" title="Sinais para o parceiro">🤫</button></div>`
    : "";
  const parceiro = v.parceiro
    ? `<div class="parceiro-cartas">Cartas do parceiro<div class="fila">${v.parceiro.map((c) => cartaHtml(c, v.manilha, "mini")).join("")}</div></div>`
    : "";

  let fim = "";
  if (v.fase === "fim") {
    const ganhei = v.vencedor === meu;
    fim = `<div class="fim ${ganhei ? "ganhou" : "perdeu"}">
      <h1>${ganhei ? "Vitória!" : "Derrota"}</h1>
      <div class="sub">Placar final: ${nos} x ${eles}<br>${esc(v.resumo)}</div>
      ${mesa ? `<button class="botao destaque" data-a="novo">Nova partida</button>` : `<div class="sub">Aguardando o anfitrião...</div>`}
      <button class="botao" data-a="menu">Sair</button>
    </div>`;
  }

  app.innerHTML = `
  <div id="jogo">
    <div class="topo">
      <button class="sair" data-a="sair">Sair</button>
      <div class="placar">
        <div class="lado nos"><small>Nós</small><b>${nos}</b></div>
        <div class="vale ${v.valor >= 6 ? "alto" : ""}"><small>Vale</small><b>${v.valor}</b></div>
        <div class="lado eles"><small>Eles</small><b>${eles}</b></div>
      </div>
      <div class="vazas">${vazas}</div>
    </div>
    <div class="mesa">
      ${outros}
      <div class="vira"><span>Vira</span>${cartaHtml(v.vira, v.manilha)}<span>Manilha <b>${v.manilha}</b></span></div>
      <div class="centro">
        ${cartasMesa}
        ${banner}
      </div>
      ${menu}
      ${bolha(v.eu, "meu")}
    </div>
    <div class="base">
      ${parceiro}
      <div class="status ${minhaVez ? "sua" : ""}">${status}</div>
      <div class="acoes">${acoes}</div>
      <div class="mao ${escondendo ? "escondendo" : ""}">${mao}</div>
    </div>
    ${fim}
  </div>`;
}

function anunciar(texto: string, grito: boolean): void {
  const el = document.createElement("div");
  el.className = "aviso" + (grito ? " grito" : "");
  el.textContent = texto;
  toast.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ---------------- cliques ----------------

app.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  switch (el.dataset.a) {
    case "bots2": jogarContraBots(2); break;
    case "bots4": jogarContraBots(4); break;
    case "criar": criarSala(); break;
    case "entrar": entrarNaSala(); break;
    case "menu": sairParaMenu(); break;
    case "sair": if (confirm("Sair da partida?")) sairParaMenu(); break;
    case "comecar": agir({ t: "iniciar", n: modoEscolhido }); break;
    case "novo": agir({ t: "novo" }); break;
    case "copiar":
      void navigator.clipboard?.writeText(el.dataset.link ?? "").then(() => { el.textContent = "Link copiado!"; });
      break;
    case "jogar": {
      const i = Number(el.dataset.i);
      if (toque && selecionada !== i) { selecionada = i; desenhar(); break; } // 1º toque seleciona, 2º joga
      selecionada = -1;
      agir({ t: "jogar", i, c: escondendo });
      escondendo = false;
      break;
    }
    case "esconder": escondendo = !escondendo; desenhar(); break;
    case "sinais": menuSinais = !menuSinais; desenhar(); break;
    case "sinal": agir({ t: "sinal", s: el.dataset.s }); menuSinais = false; desenhar(); break;
    case "truco": agir({ t: "truco" }); break;
    case "resp-aceitar": agir({ t: "resp", a: "aceitar" }); break;
    case "resp-correr": agir({ t: "resp", a: "correr" }); break;
    case "resp-aumentar": agir({ t: "resp", a: "aumentar" }); break;
    case "onze-j": agir({ t: "onze", j: true }); break;
    case "onze-c": agir({ t: "onze", j: false }); break;
  }
});

app.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.name === "modo") {
    modoEscolhido = el.value === "2" ? 2 : 4;
    desenhar();
  }
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
    if (tela === "menu") {
      irParaVersao(v); // no menu ninguém perde nada: atualiza sozinho
      return;
    }
    if (document.querySelector(".nova-versao")) return;
    const b = document.createElement("button");
    b.className = "nova-versao";
    b.textContent = "Nova versão disponível — tocar para atualizar";
    b.onclick = () => irParaVersao(v);
    document.body.appendChild(b);
  } catch {
    /* sem rede ou sem versao.json (desenvolvimento) */
  }
}
void verificarVersao();
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  void verificarVersao();
  if (tela === "jogo") void pedirTrava(); // o navegador solta a trava ao ir para segundo plano
});
setInterval(() => void verificarVersao(), 5 * 60 * 1000);

desenhar();
