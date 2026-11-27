import type { Nivel } from "./bot.ts";
import { Cena } from "./cena.ts";
import { Jogo, type Modo, type Vista } from "./jogo.ts";
import { Anfitriao, Convidado, normalizarPalavra, palavraAleatoria, type Msg } from "./rede.ts";

// ---------------- estado do aparelho ----------------

const app = document.getElementById("app") as HTMLElement;
const faixa = document.getElementById("faixa") as HTMLElement;

function lerUid(): string {
  let u = localStorage.getItem("velha3d-uid");
  if (!u) {
    u = (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + Date.now()).replace(/-/g, "").slice(0, 32);
    localStorage.setItem("velha3d-uid", u);
  }
  return u;
}
const uid = lerUid();
let nome = localStorage.getItem("velha3d-nome") || "";

type Tela = "menu" | "conectando" | "jogo";
let tela: Tela = "menu";
let jogo: Jogo | null = null; // só existe no aparelho de quem manda (local, contra o computador, anfitrião)
let anf: Anfitriao | null = null;
let conv: Convidado | null = null;
let giro = 0;
let palavraSala = "";
let nivel: Nivel = "normal";
let erroMenu = "";
let textoConexao = "";
let vista: Vista | null = null;
let cena: Cena | null = null;
let jogadasAntes = 0;
let esperaFim = 0;
let trava: WakeLockSentinel | null = null;

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const icone = (j: number): string => (j === 1 ? '<span class="p1">✕</span>' : '<span class="p2">◯</span>');

// ---------------- ligação jogo <-> tela <-> rede ----------------

function receber(m: Msg): void {
  if (m.t === "estado") {
    vista = m as unknown as Vista;
    if (tela !== "jogo") { tela = "jogo"; montarJogo(); }
    atualizarJogo();
  } else if (m.t === "cheia") {
    sairParaMenu(String(m.motivo || "Não foi possível entrar."));
  } else if (m.t === "versao") {
    sairParaMenu("O anfitrião está com outra versão do jogo. Atualize a página e tente de novo.");
  }
}

function criarJogo(modo: Modo): Jogo {
  const j = new Jogo(modo, (dest, msg) => {
    if (dest === uid) receber(msg);
    else anf?.enviar(dest, msg);
  }, uid, nome, nivel);
  jogo = j;
  giro = window.setInterval(() => j.tick(), 200);
  return j;
}

// jogada deste aparelho: vai direto no jogo (quem manda) ou pela rede (convidado)
function agir(m: Msg): void {
  if (jogo) jogo.receber(uid, m);
  else conv?.enviar(m);
}

function fecharTudo(): void {
  clearInterval(giro);
  clearTimeout(esperaFim);
  anf?.fechar();
  conv?.fechar();
  anf = null;
  conv = null;
  jogo = null;
  vista = null;
  cena?.destruir();
  cena = null;
  faixa.classList.add("escondido");
  void trava?.release();
  trava = null;
}

function sairParaMenu(erro = ""): void {
  fecharTudo();
  erroMenu = erro;
  tela = "menu";
  desenharMenu();
}

function guardarNome(): void {
  const el = document.getElementById("nome") as HTMLInputElement | null;
  if (el) nome = el.value.trim().slice(0, 16);
  if (!nome) nome = "Jogador";
  localStorage.setItem("velha3d-nome", nome);
}

function iniciarLocal(modo: "local" | "bot"): void {
  guardarNome();
  fecharTudo();
  criarJogo(modo).entrar(uid, nome);
}

function criarSala(tentativa = 0): void {
  guardarNome();
  fecharTudo();
  palavraSala = palavraAleatoria();
  tela = "conectando";
  textoConexao = "Abrindo a sala...";
  desenharConectando(true);
  const j = criarJogo("online");
  anf = new Anfitriao(palavraSala, {
    aoAbrir: () => { j.entrar(uid, nome); },
    aoErro: (tipo) => {
      if (tipo === "palavra-em-uso" && tentativa < 5) criarSala(tentativa + 1);
      else sairParaMenu("Não consegui abrir a sala (" + tipo + "). Verifique a internet.");
    },
    aoEntrou: (l) => { j.entrar(l.uid, l.nome); },
    aoSaiu: (l) => { j.sair(l.uid); },
    aoMensagem: (l, msg) => { j.receber(l.uid, msg); },
  });
}

function entrarNaSala(): void {
  guardarNome();
  const p = normalizarPalavra((document.getElementById("palavra") as HTMLInputElement | null)?.value ?? "");
  if (!p) { erroMenu = "Digite a palavra da sala."; desenharMenu(); return; }
  fecharTudo();
  palavraSala = p;
  tela = "conectando";
  textoConexao = "Conectando...";
  desenharConectando(false);
  conv = new Convidado(p, uid, nome, {
    aoConectar: () => { faixa.classList.add("escondido"); },
    aoDesconectar: () => { faixa.textContent = "Conexão perdida. Reconectando..."; faixa.classList.remove("escondido"); },
    aoMensagem: receber,
    aoEstado: (t) => { textoConexao = t; if (tela === "conectando") desenharConectando(false); },
  });
}

// ---------------- telas de texto ----------------

function desenharMenu(): void {
  const sala = new URLSearchParams(location.search).get("sala") ?? "";
  app.innerHTML = `
  <div class="tela">
    <div class="logo">Velha 3D</div>
    <div class="sub">O jogo da velha de sempre, num tabuleiro em relevo com <b class="p1">✕</b> e <b class="p2">◯</b> em 3D. Para duas pessoas, no mesmo aparelho ou online.</div>
    <div class="bloco">
      <h2>Seu nome</h2>
      <input type="text" id="nome" maxlength="16" placeholder="Como você quer ser chamado" value="${esc(nome)}" autocomplete="off" />
    </div>
    <div class="bloco">
      <h2>Jogar</h2>
      <button class="botao destaque" data-a="local">2 jogadores neste aparelho</button>
      <button class="botao destaque" data-a="bot">Contra o computador</button>
      <div class="opcoes">
        <label><input type="radio" name="nivel" value="normal" ${nivel === "normal" ? "checked" : ""} /><b>Normal</b>dá para ganhar</label>
        <label><input type="radio" name="nivel" value="impossivel" ${nivel === "impossivel" ? "checked" : ""} /><b>Impossível</b>nunca perde</label>
      </div>
    </div>
    <div class="bloco">
      <h2>Online com um amigo</h2>
      <button class="botao ouro" data-a="criar">Criar sala</button>
      <div class="linha">
        <input type="text" id="palavra" maxlength="16" placeholder="palavra da sala" value="${esc(sala)}" autocomplete="off" autocapitalize="off" />
        <button class="botao destaque" data-a="entrar" style="flex:0 0 auto">Entrar</button>
      </div>
    </div>
    <div class="erro">${esc(erroMenu)}</div>
    <a class="voltar" href="../index.html">← todos os jogos</a>
  </div>`;
}

function desenharConectando(anfitriao: boolean): void {
  app.innerHTML = `
  <div class="tela">
    <div class="logo">Velha 3D</div>
    <div class="bloco">
      <h2>${anfitriao ? "Sua sala" : "Sala"}</h2>
      <div class="palavra">${esc(palavraSala)}</div>
      <div class="sub">${esc(textoConexao)}</div>
      <button class="botao" data-a="menu">Cancelar</button>
    </div>
  </div>`;
}

// ---------------- tela do jogo ----------------

// mantém a tela acesa durante a partida
async function pedirTrava(): Promise<void> {
  try {
    if ("wakeLock" in navigator && !trava) {
      trava = await navigator.wakeLock.request("screen");
      trava.addEventListener("release", () => { trava = null; });
    }
  } catch { /* sem permissão ou sem suporte */ }
}

function vibrar(padrao: number | number[]): void {
  try { navigator.vibrate?.(padrao); } catch { /* ignora */ }
}

function montarJogo(): void {
  jogadasAntes = vista!.jogadas;
  app.innerHTML = `
  <div id="jogo">
    <div class="palco"><canvas id="cena"></canvas></div>
    <div class="topo">
      <button class="sair" data-a="sair">Sair</button>
      <div class="placar">
        <div class="lado" id="lado1">${icone(1)}<b id="nome1"></b><i id="pt1">0</i></div>
        <span class="vs">×</span>
        <div class="lado" id="lado2"><i id="pt2">0</i><b id="nome2"></b>${icone(2)}</div>
      </div>
    </div>
    <div class="status" id="status"></div>
    <div class="rodape">
      <span class="dica">Arraste para girar o tabuleiro</span>
      <button class="botao" data-a="visao">Recentrar</button>
    </div>
    <div class="espera escondido" id="espera">
      <div class="sub">Chame seu amigo: ele entra em <b>Online → palavra da sala</b></div>
      <div class="palavra">${esc(palavraSala)}</div>
      <button class="botao" data-a="copiar">Copiar link da sala</button>
    </div>
    <div class="fim escondido" id="fim">
      <h1 id="fim-titulo"></h1>
      <div class="sub" id="fim-sub"></div>
      <button class="botao destaque" data-a="revanche">Jogar de novo</button>
      <button class="botao" data-a="menu">Sair</button>
    </div>
  </div>`;
  cena = new Cena($<HTMLCanvasElement>("cena"), {
    escolher: (i) => { if (podeJogar()) { cena?.definirPreview(null, 1); agir({ t: "jogar", i }); } },
    passar: (i) => { if (podeJogar()) cena?.definirPreview(i, vista!.vez); },
  });
  void pedirTrava();
}

function podeJogar(): boolean {
  const v = vista;
  return !!v && !v.aguardando && !v.fim && v.meus.includes(v.vez);
}

function atualizarJogo(): void {
  const v = vista!;
  if (!cena) return;
  cena.atualizar({ cel: v.cel.split("").map(Number), linha: v.linha });
  cena.permitirJogar(podeJogar());

  // quem é quem
  const eu = v.meus.length === 1 ? v.meus[0] : 0;
  $("nome1").textContent = v.nomes[0] + (eu === 1 ? " (você)" : "");
  $("nome2").textContent = v.nomes[1] + (eu === 2 ? " (você)" : "");
  $("pt1").textContent = String(v.placar[0]);
  $("pt2").textContent = String(v.placar[1]);
  $("lado1").classList.toggle("vez", !v.fim && !v.aguardando && v.vez === 1);
  $("lado2").classList.toggle("vez", !v.fim && !v.aguardando && v.vez === 2);

  let status = "";
  if (v.aguardando) status = "Aguardando o adversário entrar...";
  else if (v.fim) status = v.vencedor === 0 ? "Deu velha! Empate" : `${icone(v.vencedor)} ${esc(v.nomes[v.vencedor - 1])} venceu!`;
  else if (v.modo === "online" && v.off[v.meus.includes(1) ? 1 : 0]) status = "Adversário desconectado... aguardando ele voltar";
  else if (v.modo === "online" && v.meus.includes(v.vez)) status = `${icone(v.vez)} Sua vez`;
  else if (v.modo === "bot" && !v.meus.includes(v.vez)) status = `${icone(v.vez)} Computador pensando...`;
  else status = `${icone(v.vez)} Vez de ${esc(v.nomes[v.vez - 1])}`;
  const st = $("status");
  st.innerHTML = status;
  st.classList.toggle("sua", podeJogar() && v.modo === "online");
  $("espera").classList.toggle("escondido", !v.aguardando);

  // o cartão de fim espera a última peça cair, para dar para ver a jogada
  const fim = $("fim");
  clearTimeout(esperaFim);
  if (!v.fim) fim.classList.add("escondido");
  else {
    let titulo: string;
    if (v.vencedor === 0) titulo = "Deu velha!";
    else if (v.modo === "local") titulo = `${v.nomes[v.vencedor - 1]} venceu!`;
    else if (v.meus.includes(v.vencedor)) titulo = "Você venceu! 🎉";
    else titulo = v.modo === "bot" ? "O computador venceu" : `${v.nomes[v.vencedor - 1]} venceu`;
    $("fim-titulo").textContent = titulo;
    $("fim-sub").textContent = `Placar: ${v.placar[0]} × ${v.placar[1]}`;
    esperaFim = window.setTimeout(() => document.getElementById("fim")?.classList.remove("escondido"), 1100);
  }

  // celular vibra quando o adversário joga e a vez volta para você
  if (v.modo === "online" && v.jogadas > jogadasAntes && !v.fim && v.meus.includes(v.vez)) vibrar(40);
  jogadasAntes = v.jogadas;
}

// ---------------- cliques ----------------

app.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-a]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  switch (el.dataset.a) {
    case "local": iniciarLocal("local"); break;
    case "bot": iniciarLocal("bot"); break;
    case "criar": criarSala(); break;
    case "entrar": entrarNaSala(); break;
    case "menu": sairParaMenu(); break;
    case "sair": if (confirm("Sair da partida?")) sairParaMenu(); break;
    case "revanche": agir({ t: "revanche" }); break;
    case "visao": cena?.resetarCamera(); break;
    case "copiar": {
      const link = `${location.origin}${location.pathname}?sala=${encodeURIComponent(palavraSala)}`;
      void navigator.clipboard?.writeText(link).then(() => { el.textContent = "Link copiado!"; });
      break;
    }
  }
});

app.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.name === "nivel") nivel = el.value === "impossivel" ? "impossivel" : "normal";
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
    if (tela === "menu") { irParaVersao(v); return; } // no menu ninguém perde nada: atualiza sozinho
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
  if (tela === "jogo") void pedirTrava(); // o navegador solta a trava ao ir para segundo plano
});
setInterval(() => void verificarVersao(), 5 * 60 * 1000);

desenharMenu();
