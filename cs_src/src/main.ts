// main.ts
// Liga tudo: painéis de lobby, loop do jogo, HUD, host autoritativo e predição do convidado.

import { somAcerto, somDano, somExplosao, somMorte, somTiro } from "./audio";
import { HostGame } from "./hostgame";
import { Entrada } from "./input";
import { Amigos, apelidoValido } from "./amigos";
import { LIMITES, ajustesPadrao, carregarAjustes, salvarAjustes } from "./ajustes";
import type { Ajustes, Qualidade } from "./ajustes";
import { Bot } from "./bot";
import { Grupo } from "./grupo";
import type { InicioPartida, ModoJogo } from "./grupo";
import type { Dificuldade } from "./bot";
import { CODIGO_MAX, CODIGO_MIN, GuestNet, HostNet, normalizarCodigo } from "./net";
import { Renderer } from "./renderer";
import { montarToque } from "./toque";
import { ARMAS, CORES, MAX_JOGADORES, NOMES_ARMAS, ROUNDS_PARA_VENCER, SLOT_GRANADA, SPAWNS, moverCorpo } from "./shared";
import type { Corpo } from "./shared";
import type { BoomMsg, Cmd, HostMsg, KillMsg, PlayerInfo, ShotMsg, Snapshot } from "./types";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>("jogo");
const wrap = $("wrap");
const overlay = $("overlay");
const hud = $("hud");

const PAINEIS = ["painelNome", "painelLobby", "painelAmigos", "painelAjustes", "painelConectando", "painelCriar", "painelHost", "painelJoin", "painelPausa", "painelFim"];

const inputNome = $<HTMLInputElement>("inputNome");
const inputCodigo = $<HTMLInputElement>("inputCodigo");
const inputSenha = $<HTMLInputElement>("inputSenha");
const statusCriar = $("statusCriar");
const codigoHost = $("codigoHost");
const statusHost = $("statusHost");
const statusJoin = $("statusJoin");
const listaHost = $("listaHost");
const listaJoin = $("listaJoin");
const listaFim = $("listaFim");
const btnIniciar = $<HTMLButtonElement>("btnIniciar");
const btnConectar = $<HTMLButtonElement>("btnConectar");
const btnJogarDeNovo = $<HTMLButtonElement>("btnJogarDeNovo");
const subtitulo = $("subtitulo");

const renderer = new Renderer(canvas, wrap);

// ---- Utilidades ----

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const cacheHtml = new Map<HTMLElement, string>();
function definirHtml(el: HTMLElement, html: string): void {
  if (cacheHtml.get(el) === html) return;
  cacheHtml.set(el, html);
  el.innerHTML = html;
}

function listaHtml(infos: PlayerInfo[], eu = -1, hostId = 0): string {
  return infos
    .map((i) => {
      const tag = i.id === eu ? " (você)" : "";
      const host = i.id === hostId ? " · host" : "";
      return `<div><span class="ponto" style="background:${i.cor}"></span> ${esc(i.nome)}${tag}${host}</div>`;
    })
    .join("");
}

function mostrarPainel(nome: string): void {
  overlay.classList.remove("hidden");
  overlay.classList.toggle("lobby-ativo", nome === "painelLobby");
  overlay.classList.toggle("ajustes-ativo", nome === "painelAjustes");
  for (const id of PAINEIS) $(id).classList.toggle("hidden", id !== nome);
}

// ---- Estado ----

type Modo = "host" | "guest" | "solo" | null;

let modo: Modo = null;
let eu = 0;
let infos: PlayerInfo[] = [];
let rodando = false;
let fimMostrado = false;
let fimInicio = 0; // instante em que a partida terminou (0 = ainda não terminou)
const ATRASO_FIM = 2500;      // ms jogando/vendo o resultado antes do painel final
const TRAVA_BOTOES_FIM = 1000; // ms com os botões do painel final desativados (evita clique perdido)
let ultimaRodada = 0;
let minhaPos: [number, number, number] = [0, 0, 0];

let meuNome = localStorage.getItem("cs_nome") ?? "";

let hostNet: HostNet | null = null;
let guestNet: GuestNet | null = null;
let jogo: HostGame | null = null;
let bots: Bot[] = [];

// predição do convidado
let corpo: Corpo | null = null;
let pendentes: Cmd[] = [];
let saida: Cmd[] = [];
let seq = 0;
let ultimaSnap: Snapshot | null = null;

const entrada = new Entrada(canvas, (travado) => {
  if (travado) overlay.classList.add("hidden");
  else if (rodando && !fimMostrado && !fimInicio) mostrarPainel("painelPausa");
});

// ---- Celular/tablet ----

if (entrada.toque) {
  document.body.classList.add("toque");
  // primeiro toque em qualquer lugar: tela cheia e paisagem travada (precisa de um gesto do usuário)
  document.addEventListener("click", () => entrada.prepararTela(), { once: true, capture: true });
  montarToque(entrada, () => entrada.soltar(), () => abrirAjustes());
  $("btnRetomar").textContent = "Toque para jogar";
  $("ajudaControles").innerHTML =
    "Arraste à esquerda para <b>andar</b> · à direita para <b>mirar</b><br>" +
    "<b>FOGO</b> atira (arraste o mesmo dedo para mirar) · toque nas armas para trocar<br>" +
    "Último de pé vence o round. Primeiro a 5 rounds vence.";
  // ao sair do app/aba, pausa em vez de deixar você tomando tiro
  document.addEventListener("visibilitychange", () => { if (document.hidden && rodando) entrada.soltar(); });
}

// toque na barra de armas troca de arma
$("armas").addEventListener("pointerdown", (e) => {
  const slot = (e.target as HTMLElement).closest<HTMLElement>("[data-slot]")?.dataset.slot;
  if (slot !== undefined && entrada.travado) entrada.arma = Number(slot);
});

// ---- Nome ----

inputNome.value = meuNome;
let acaoAposNome: (() => void) | null = null; // ex.: aceitar um link de convite antes de ter nome

$("btnContinuar").addEventListener("click", () => {
  meuNome = inputNome.value.trim().slice(0, 14);
  localStorage.setItem("cs_nome", meuNome);
  const acao = acaoAposNome;
  acaoAposNome = null;
  renderLobby();
  if (acao) acao();
  else mostrarPainel("painelLobby");
});
inputNome.addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnContinuar").click(); });
$("btnTrocarNome").addEventListener("click", () => mostrarPainel("painelNome"));

// ---- Amigos ----

const amigos = new Amigos(() => meuNome || "Jogador", {
  aoMudar: () => { grupo.sincronizar(); renderAmigos(); renderLobby(); },
  aoGrupo: (de, m) => grupo.aoMensagem(de.id, de.nome, m),
  aoConvite: (de, sala) => mostrarConvite(de.nome, sala),
  aoAviso: (msg) => { msgAmigos.textContent = msg; mostrarToast(msg); },
});

// aviso rápido visível em qualquer tela (ex.: "Fulano entrou na sua lista de amigos")
let toastTimer: number | undefined;
function mostrarToast(texto: string): void {
  const el = $("toastAviso");
  el.textContent = texto;
  el.classList.remove("hidden");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 6000);
}

const msgAmigos = $("msgAmigos");
const listaAmigos = $("listaAmigos");
const pedidosAmigos = $("pedidosAmigos");
const enviadosAmigos = $("enviadosAmigos");
const amigosConvidar = $("amigosConvidar");
const inputApelido = $<HTMLInputElement>("inputApelido");
const inputCodigoAmigo = $<HTMLInputElement>("inputCodigoAmigo");
const convidados = new Set<string>(); // amigos já convidados para a sala atual

const STATUS_AMIGOS: Record<string, string> = {
  pronto: "● Você está online para seus amigos",
  conectando: "Conectando...",
  erro: "Sem conexão com o servidor. Tentando de novo...",
  ocupado: "Esse apelido já está em uso (por outra pessoa ou por outra aba deste navegador). Escolha outro e salve.",
  indisponivel: "Amigos só funciona em https ou em localhost.",
};

function linhaAmigo(nome: string, apelido: string, estado: "online" | "offline" | "pendente", botao: string, motivo = ""): string {
  const cor = estado === "online" ? "var(--accent)" : estado === "pendente" ? "var(--accent3)" : "var(--muted)";
  const rotuloApelido = nome === apelido ? "" : ` (${esc(apelido)})`;
  const situacao = estado === "online" ? " · online" : estado === "offline" ? " · offline" : "";
  const motivoHtml = motivo ? `<br><small>${esc(motivo)}</small>` : "";
  return `<div class="amigo${estado === "online" ? "" : " offline"}"><span class="nome"><span class="ponto" style="background:${cor}"></span><span>${esc(nome)}${rotuloApelido}${situacao}${motivoHtml}</span></span>${botao}</div>`;
}

const vazio = (texto: string): string => `<div class="vazio">${texto}</div>`;
const MOTIVO_DESATUALIZADA = "ele não aceita mais o seu segredo: um dos dois removeu o outro. Refaça a amizade.";

function renderAmigos(): void {
  const lista = amigos.lista();
  const pedidos = amigos.pedidos();
  const confirmados = lista.filter((x) => !x.pendente);
  const enviados = lista.filter((x) => x.pendente);
  const n = amigos.totalOnline();

  const partes = [n > 0 ? `${n} online` : "", pedidos.length > 0 ? `${pedidos.length} pedido${pedidos.length > 1 ? "s" : ""}` : ""].filter(Boolean);
  $("btnAmigos").textContent = partes.length ? `Amigos (${partes.join(" · ")})` : "Amigos";
  $("statusAmigos").textContent = STATUS_AMIGOS[amigos.estado] ?? "";
  if (document.activeElement !== inputApelido) inputApelido.value = amigos.apelido;

  // pedidos que outras pessoas fizeram para você: precisam do seu aceite
  $("tituloPedidos").textContent = `Pedidos para você aprovar (${pedidos.length})`;
  pedidosAmigos.classList.toggle("destaque", pedidos.length > 0);
  pedidosAmigos.innerHTML = pedidos.length
    ? pedidos
        .map((p) => `<div class="amigo"><span class="nome"><span class="ponto" style="background:var(--accent3)"></span><span>${esc(p.nome)} (${esc(p.id)}) quer ser seu amigo</span></span><span class="linha"><button data-aceitar="${p.id}">Aceitar</button><button class="secundario" data-recusar="${p.id}">Recusar</button></span></div>`)
        .join("")
    : vazio("Nenhum pedido no momento.");

  // amigos de verdade (já aceitos)
  $("tituloAmigos").textContent = `Meus amigos (${confirmados.length}${n > 0 ? ` · ${n} online` : ""})`;
  listaAmigos.innerHTML = confirmados.length
    ? confirmados
        .map(({ amigo, online, desatualizado }) => desatualizado
          ? linhaAmigo(amigo.nome, amigo.id, "offline",
              `<span class="linha"><button data-refazer="${amigo.id}">Refazer amizade</button><button class="secundario" data-remover="${amigo.id}">Remover</button></span>`,
              MOTIVO_DESATUALIZADA)
          : linhaAmigo(amigo.nome, amigo.id, online ? "online" : "offline", `<button class="secundario" data-remover="${amigo.id}">Remover</button>`))
        .join("")
    : vazio("Você ainda não tem amigos. Convide alguém pelo link ou pelo apelido.");

  // pedidos que você mandou e o outro lado ainda não aceitou
  $("tituloEnviados").textContent = `Pedidos enviados, aguardando (${enviados.length})`;
  enviadosAmigos.innerHTML = enviados.length
    ? enviados
        .map(({ amigo, detalhe }) => linhaAmigo(amigo.nome, amigo.id, "pendente", `<button class="secundario" data-remover="${amigo.id}">Cancelar</button>`, detalhe))
        .join("")
    : vazio("Nenhum pedido aguardando resposta.");

  // convites na sala do host: só amigos online
  const online = confirmados.filter((x) => x.online);
  amigosConvidar.innerHTML = online.length
    ? `<p class="rotulo">Amigos online (toque para convidar para esta sala):</p>` +
      online
        .map(({ amigo }) => {
          const ja = convidados.has(amigo.id);
          return linhaAmigo(amigo.nome, amigo.id, "online", `<button data-convidar="${amigo.id}"${ja ? " disabled" : ""}>${ja ? "Convidado ✓" : "Convidar"}</button>`);
        })
        .join("")
    : "";
}

$("btnAmigos").addEventListener("click", () => {
  msgAmigos.textContent = "";
  renderAmigos();
  mostrarPainel("painelAmigos");
});
$("btnVoltarAmigos").addEventListener("click", () => mostrarPainel("painelLobby"));

function limparCampo(input: HTMLInputElement): void {
  const limpo = normalizarCodigo(input.value);
  if (limpo !== input.value) input.value = limpo;
}
inputApelido.addEventListener("input", () => limparCampo(inputApelido));
inputCodigoAmigo.addEventListener("input", () => limparCampo(inputCodigoAmigo));

function salvarApelido(): void {
  if (apelidoValido(inputApelido.value) === amigos.apelido) { msgAmigos.textContent = "Esse já é o seu apelido."; return; }
  if (amigos.lista().length > 0 && !confirm("Trocar o apelido remove sua lista de amigos (eles conhecem o apelido antigo). Continuar?")) {
    inputApelido.value = amigos.apelido;
    return;
  }
  const erro = amigos.trocarApelido(inputApelido.value);
  if (!erro) grupo.reiniciar();
  msgAmigos.textContent = erro ?? "Apelido salvo. Passe ele para seus amigos.";
}
$("btnSalvarApelido").addEventListener("click", salvarApelido);
inputApelido.addEventListener("keydown", (e) => { if (e.key === "Enter") salvarApelido(); });

$("btnCopiar").addEventListener("click", () => {
  if (!amigos.apelido) return;
  navigator.clipboard.writeText(amigos.apelido).then(
    () => { msgAmigos.textContent = "Apelido copiado!"; },
    () => { msgAmigos.textContent = "Não consegui copiar. Selecione o apelido e copie."; },
  );
});

function adicionarAmigo(): void {
  const erro = amigos.adicionar(inputCodigoAmigo.value);
  if (erro) { msgAmigos.textContent = erro; return; }
  inputCodigoAmigo.value = "";
  msgAmigos.textContent = "Pedido enviado. Ele precisa estar online e aceitar.";
}
$("btnAdicionar").addEventListener("click", adicionarAmigo);
inputCodigoAmigo.addEventListener("keydown", (e) => { if (e.key === "Enter") adicionarAmigo(); });

function dado(e: Event, atributo: string): string | undefined {
  return (e.target as HTMLElement).closest<HTMLElement>(`[data-${atributo}]`)?.dataset[atributo];
}

function refazerAmizade(id: string): void {
  amigos.refazer(id);
  mostrarToast("Pedido enviado de novo. Seu amigo precisa aceitar.");
}

for (const lista of [listaAmigos, enviadosAmigos]) {
  lista.addEventListener("click", (e) => {
    const id = dado(e, "remover");
    if (id) amigos.remover(id);
    const refazer = dado(e, "refazer");
    if (refazer) refazerAmizade(refazer);
  });
}

pedidosAmigos.addEventListener("click", (e) => {
  const aceitar = dado(e, "aceitar");
  const recusar = dado(e, "recusar");
  if (aceitar) amigos.aceitar(aceitar);
  else if (recusar) amigos.recusar(recusar);
});

amigosConvidar.addEventListener("click", (e) => {
  const id = dado(e, "convidar");
  const sala = codigoHost.textContent ?? "";
  if (!id || !/^[a-z0-9]+$/.test(sala)) return;
  if (amigos.convidar(id, sala)) { convidados.add(id); renderAmigos(); }
});

// aviso com botão de aceitar (convite de sala de um amigo, ou link de convite recebido)
const caixaConvite = $("convite");
let conviteAcao: (() => void) | null = null;
let conviteIgnorar: (() => void) | null = null;
let conviteTimer: number | undefined;

function esconderConvite(): void {
  caixaConvite.classList.add("hidden");
  window.clearTimeout(conviteTimer);
  conviteAcao = null;
  conviteIgnorar = null;
}

function mostrarAviso(texto: string, rotulo: string, acao: () => void, duracaoMs = 60000, aoIgnorar?: () => void): void {
  conviteAcao = acao;
  conviteIgnorar = aoIgnorar ?? null;
  $("textoConvite").textContent = texto;
  $("btnAceitarConvite").textContent = rotulo;
  caixaConvite.classList.remove("hidden");
  window.clearTimeout(conviteTimer);
  conviteTimer = window.setTimeout(esconderConvite, duracaoMs);
}

function entrarNaSala(sala: string): void {
  resetarParaInicio();
  inputCodigo.value = sala;
  mostrarPainel("painelJoin");
  conectar();
}

function mostrarConvite(nome: string, sala: string): void {
  if (rodando && overlay.classList.contains("hidden")) return; // não interrompe quem está jogando
  mostrarAviso(`${nome} te chamou para uma sala`, "Entrar", () => entrarNaSala(sala));
}

$("btnIgnorarConvite").addEventListener("click", () => {
  const ignorar = conviteIgnorar;
  esconderConvite();
  ignorar?.();
});
$("btnAceitarConvite").addEventListener("click", () => {
  const acao = conviteAcao;
  esconderConvite();
  acao?.();
});

// ---- Link de convite (WhatsApp) ----

// o link leva o apelido e um código de uso único; no #hash para nunca ir ao servidor
function linkConvite(sala?: string): string {
  const payload = amigos.criarConvite();
  if (!payload) return "";
  const p = new URLSearchParams({ amigo: payload });
  if (sala) p.set("sala", sala);
  return `${location.origin}${location.pathname}#${p}`;
}

function enviarPorWhatsApp(aviso: HTMLElement, sala?: string): void {
  const link = linkConvite(sala);
  if (!link) { aviso.textContent = "Amigos exige https ou localhost."; return; }
  const texto = `${meuNome || "Um amigo"} te chamou para jogar CS Caps${sala ? " (a sala já está pronta!)" : ""}: ${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  aviso.textContent = "Link enviado. Volte para cá e mantenha o jogo aberto até seu amigo entrar.";
}

function copiarLink(aviso: HTMLElement, sala?: string): void {
  const link = linkConvite(sala);
  if (!link) { aviso.textContent = "Amigos exige https ou localhost."; return; }
  navigator.clipboard.writeText(link).then(
    () => { aviso.textContent = "Link copiado! Cole no WhatsApp e mantenha o jogo aberto até seu amigo entrar."; },
    () => { aviso.textContent = "Não consegui copiar o link."; },
  );
}

function salaAtual(): string {
  const sala = codigoHost.textContent ?? "";
  return /^[a-z0-9]+$/.test(sala) ? sala : "";
}

$("btnLinkWhats").addEventListener("click", () => enviarPorWhatsApp(msgAmigos));
$("btnLinkCopiar").addEventListener("click", () => copiarLink(msgAmigos));
$("btnSalaWhats").addEventListener("click", () => { const s = salaAtual(); if (s) enviarPorWhatsApp(statusHost, s); });
$("btnSalaCopiar").addEventListener("click", () => { const s = salaAtual(); if (s) copiarLink(statusHost, s); });

// quem abre um link recebido: confirma, adiciona o amigo e, se tiver sala, já entra nela
interface LinkRecebido { apelido: string; token: string; sala: string }

function lerLinkRecebido(): LinkRecebido | null {
  const p = new URLSearchParams(location.hash.slice(1));
  const m = /^([a-z0-9]{3,20})\.([a-z0-9]{16})$/.exec((p.get("amigo") ?? "").toLowerCase());
  if (!m) return null;
  // limpa o endereço: atualizar a página não repete o convite
  history.replaceState(null, "", location.pathname + location.search);
  return { apelido: m[1], token: m[2], sala: normalizarCodigo(p.get("sala") ?? "") };
}

function aceitarLink(link: LinkRecebido): void {
  const executar = () => {
    const erro = amigos.adicionar(link.apelido, link.token);
    if (link.sala) { entrarNaSala(link.sala); return; }
    msgAmigos.textContent = erro ?? `Pedido enviado para ${link.apelido}. Você entra na lista assim que ele estiver online.`;
    renderAmigos();
    mostrarPainel("painelAmigos");
  };
  if (!meuNome) { acaoAposNome = executar; mostrarPainel("painelNome"); return; } // precisa de um nome antes
  executar();
}

// ---- Lobby e grupo ----

let conectandoGrupo = false;
let timerGrupo: number | undefined;

const grupo = new Grupo(
  {
    meuId: () => amigos.apelido,
    meuNome: () => meuNome || "Jogador",
    enviar: (id, m) => amigos.enviar(id, m),
    online: (id) => amigos.estaOnline(id),
    ocupado: () => rodando || conectandoGrupo,
  },
  {
    aoMudar: () => renderLobby(),
    aoConvite: (_id, nome) =>
      mostrarAviso(`${nome} te chamou para o grupo`, "Entrar", () => grupo.aceitarConvite(), 60000, () => grupo.recusarConvite()),
    aoIniciar: (inicio) => iniciarDoGrupo(inicio),
    aoAviso: (msg) => mostrarToast(msg),
  },
);

let assinaturaLobby = "";

// diz ao 3D quanto da tela está livre entre os painéis, para os personagens não ficarem atrás deles
function atualizarAreaLobby(): void {
  const centro = document.querySelector<HTMLElement>(".lobby-centro");
  if (centro && centro.clientWidth > 0) renderer.definirAreaLobby(centro.clientWidth / window.innerWidth);
}
window.addEventListener("resize", atualizarAreaLobby);

function renderLobby(): void {
  const meuId = amigos.apelido;
  const membros = grupo.membros;
  const lider = grupo.souLider;
  const cfg = grupo.config;
  const nomeEu = meuNome || "Jogador";
  $("lobbyNome").textContent = nomeEu;

  // palco 3D: você no centro e os amigos ao redor, com as cores que terão na partida
  const palco = membros.map((m, i) => ({
    nome: m.id === meuId ? nomeEu : m.nome, cor: CORES[i], pronto: m.pronto, eu: m.id === meuId,
  }));
  const ordem = [...palco.filter((x) => x.eu), ...palco.filter((x) => !x.eu)].map(({ nome, cor, pronto }) => ({ nome, cor, pronto }));
  const assinatura = JSON.stringify(ordem);
  if (assinatura !== assinaturaLobby) { assinaturaLobby = assinatura; renderer.definirLobby(ordem); }
  atualizarAreaLobby();

  // vagas do grupo
  $("tituloGrupo").textContent = `Grupo (${membros.length}/${MAX_JOGADORES})`;
  const vagas = membros.map((m, i) => {
    const euMesmo = m.id === meuId;
    return `<div class="slot-membro${euMesmo ? " eu" : ""}${m.pronto ? " pronto" : ""}"><span class="ponto" style="background:${CORES[i]}"></span>` +
      `<span class="nome">${m.id === grupo.lider ? "♛ " : ""}${esc(euMesmo ? nomeEu : m.nome)}${euMesmo ? " (você)" : ""}</span>` +
      `<small>${m.pronto ? "PRONTO ✓" : "aguardando"}</small></div>`;
  });
  for (let i = membros.length; i < MAX_JOGADORES; i++) {
    const cpu = cfg.modo === "cpu" && i < membros.length + cfg.cpus;
    vagas.push(cpu
      ? `<div class="slot-cpu"><span class="ponto" style="background:${CORES[i]}"></span>CPU · ${cfg.dificuldade === "facil" ? "fácil" : cfg.dificuldade === "dificil" ? "difícil" : "normal"}</div>`
      : `<div class="slot-vazio">+ vaga livre</div>`);
  }
  $("slotsGrupo").innerHTML = vagas.join("");
  const btnSair = $("btnSairGrupo");
  btnSair.classList.toggle("hidden", !grupo.emGrupo);
  btnSair.textContent = lider ? "Desfazer grupo" : "Sair do grupo";

  // modo de jogo (só o líder escolhe)
  for (const b of document.querySelectorAll<HTMLButtonElement>("#modos .modo")) {
    b.classList.toggle("ativo", b.dataset.modo === cfg.modo);
    b.disabled = !lider;
  }
  $("configCpu").classList.toggle("hidden", cfg.modo !== "cpu");
  const livres = MAX_JOGADORES - membros.length;
  const selCpus = $<HTMLSelectElement>("selCpus");
  if (selCpus.dataset.max !== String(livres)) {
    selCpus.dataset.max = String(livres);
    selCpus.innerHTML = livres > 0
      ? Array.from({ length: livres }, (_, k) => `<option value="${k + 1}">${k + 1}</option>`).join("")
      : `<option value="0">0</option>`;
  }
  selCpus.value = String(cfg.cpus);
  selCpus.disabled = !lider || livres === 0;
  const selDif = $<HTMLSelectElement>("selDificuldade");
  selDif.value = cfg.dificuldade;
  selDif.disabled = !lider;
  $("avisoLider").textContent = lider ? "" : "Só o líder do grupo escolhe o modo.";

  // amigos: o líder convida quem está online
  const confirmados = amigos.lista().filter((x) => !x.pendente).sort((a, b) => Number(b.online) - Number(a.online));
  $("lobbyAmigos").innerHTML = confirmados.length
    ? confirmados.map(({ amigo, online, desatualizado }) => {
        if (desatualizado) {
          return linhaAmigo(amigo.nome, amigo.id, "offline", `<button class="mini" data-refazer="${amigo.id}">Refazer</button>`, "amizade desatualizada");
        }
        const noGrupo = membros.some((m) => m.id === amigo.id);
        let acao = `<small>${online ? "online" : "offline"}</small>`;
        if (noGrupo) acao = `<small>no grupo</small>`;
        else if (grupo.jaConvidado(amigo.id)) acao = `<button class="mini" disabled>Convite enviado</button>`;
        else if (online && lider && membros.length < MAX_JOGADORES) acao = `<button class="mini" data-convidargrupo="${amigo.id}">Convidar</button>`;
        return linhaAmigo(amigo.nome, amigo.id, online ? "online" : "offline", acao);
      }).join("")
    : vazio("Você ainda não tem amigos. Abra <b>Amigos</b> e convide por link.");

  // botão principal
  const btn = $<HTMLButtonElement>("btnPronto");
  const status = $("lobbyProntoStatus");
  const bloqueio = grupo.motivoBloqueio();
  btn.classList.toggle("pronto", grupo.emGrupo && grupo.eu.pronto);
  if (conectandoGrupo) {
    btn.textContent = "CONECTANDO...";
    btn.disabled = true;
    status.textContent = "";
  } else if (!grupo.emGrupo) {
    btn.textContent = bloqueio ? "CHAME UM AMIGO" : "JOGAR";
    btn.disabled = !!bloqueio;
    status.textContent = bloqueio ?? "";
  } else {
    btn.textContent = grupo.eu.pronto ? "CANCELAR PRONTO" : "PRONTO";
    btn.disabled = !grupo.eu.pronto && !!bloqueio;
    const faltam = membros.filter((m) => !m.pronto).map((m) => (m.id === meuId ? "você" : m.nome));
    status.textContent = bloqueio && !grupo.eu.pronto ? bloqueio : faltam.length ? `Aguardando: ${faltam.join(", ")}` : "Todos prontos!";
  }
}

$("btnPronto").addEventListener("click", () => grupo.alternarPronto());
$("btnSairGrupo").addEventListener("click", () => grupo.sair());
for (const b of document.querySelectorAll<HTMLButtonElement>("#modos .modo")) {
  b.addEventListener("click", () => grupo.definirConfig({ modo: b.dataset.modo as ModoJogo }));
}
$("selCpus").addEventListener("change", (e) => grupo.definirConfig({ cpus: Number((e.target as HTMLSelectElement).value) }));
$("selDificuldade").addEventListener("change", (e) => grupo.definirConfig({ dificuldade: (e.target as HTMLSelectElement).value as Dificuldade }));
$("lobbyAmigos").addEventListener("click", (e) => {
  const refazer = dado(e, "refazer");
  if (refazer) { refazerAmizade(refazer); return; }
  const id = dado(e, "convidargrupo");
  if (!id) return;
  const erro = grupo.convidar(id);
  if (erro) mostrarToast(erro);
});

// ---- Início da partida do grupo ----

function limparEspera(): void {
  window.clearTimeout(timerGrupo);
  conectandoGrupo = false;
}

function falhaGrupo(msg: string): void {
  limparEspera();
  hostNet?.fechar();
  guestNet?.fechar();
  hostNet = null;
  guestNet = null;
  mostrarToast(msg);
  mostrarPainel("painelLobby");
  renderLobby();
}

$("btnCancelarConexao").addEventListener("click", () => falhaGrupo("Cancelado."));

function iniciarDoGrupo(inicio: InicioPartida): void {
  const { config } = inicio;

  // sozinho: treino contra CPUs, sem rede
  if (inicio.papel === "lider" && inicio.humanos === 1) {
    const players: PlayerInfo[] = [{ id: 0, nome: meuNome || "Você", cor: CORES[0] }];
    bots = [];
    for (let k = 1; k <= config.cpus; k++) {
      players.push({ id: k, nome: `CPU ${k}`, cor: CORES[k] });
      bots.push(new Bot(k, config.dificuldade));
    }
    iniciarPartida(players, 0, "solo");
    return;
  }

  conectandoGrupo = true;
  $("textoConectando").textContent = inicio.papel === "lider" ? "Abrindo a sala do grupo..." : "Entrando na sala do grupo...";
  mostrarPainel("painelConectando");
  renderLobby();
  timerGrupo = window.setTimeout(() => falhaGrupo("O grupo não conseguiu se conectar a tempo."), 25000);

  if (inicio.papel === "lider") abrirSalaDoGrupo(inicio);
  else entrarNaSalaDoGrupo(inicio);
}

// o líder abre a sala, avisa os membros e começa quando todos conectarem
function abrirSalaDoGrupo(inicio: InicioPartida): void {
  hostNet = new HostNet(meuNome, inicio.sala, {
    aoAbrir: () => {
      $("textoConectando").textContent = "Esperando o grupo entrar...";
      grupo.liberarSala(inicio.sala);
    },
    aoMudarLobby: () => {
      if (!hostNet || hostNet.iniciada) return;
      const prontos = hostNet.convidados.filter((g) => g.ola && g.conn.open).length;
      if (prontos + 1 < inicio.humanos) return;
      const players = hostNet.iniciar(inicio.config.cpus);
      bots = players.slice(inicio.humanos).map((p) => new Bot(p.id, inicio.config.dificuldade));
      iniciarPartida(players, 0, "host");
    },
    aoMensagem: (g, m) => {
      if (m.t === "cmds" && jogo) for (const c of m.cmds) jogo.aplicarComando(g.pid, c);
    },
    aoSair: (g) => jogo?.desconectar(g.pid),
    aoErro: (msg) => falhaGrupo(`Não consegui abrir a sala do grupo (${msg}).`),
  });
}

// os membros entram na sala do líder assim que ele a anuncia
function entrarNaSalaDoGrupo(inicio: InicioPartida): void {
  guestNet = new GuestNet(inicio.sala, meuNome, {
    aoConectar: () => { $("textoConectando").textContent = "Conectado! Aguardando o início..."; },
    aoMensagem: aoMensagemHost,
    aoFechar: () => {
      if (rodando) perderConexao();
      else if (conectandoGrupo) falhaGrupo("A conexão com o grupo foi encerrada.");
    },
    aoErro: (msg) => falhaGrupo(msg === "peer-unavailable" ? "Não encontrei a sala do grupo." : `Erro de conexão (${msg}).`),
  }, grupo.minhaVaga);
}

// ---- Versão nova do site ----
// O navegador guarda a página por alguns minutos: um aparelho pode ficar rodando uma versão antiga, que não "fala a mesma
// língua" da do amigo. Compara o script em uso com o da página publicada e avisa quando mudou.

function scriptEmUso(): string | null {
  const url = [...document.scripts].map((x) => x.src).find((u) => /\/assets\/index-[^/]+\.js/.test(u));
  return url ? url.slice(url.lastIndexOf("/") + 1) : null;
}

async function verificarVersao(): Promise<void> {
  const emUso = scriptEmUso();
  if (!emUso) return; // servidor de desenvolvimento: não há versão publicada para comparar
  try {
    const r = await fetch(`${location.pathname}?_=${Date.now()}`, { cache: "no-store" });
    const m = /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(await r.text());
    if (m && m[1] !== emUso) $("avisoVersao").classList.remove("hidden");
  } catch { /* sem rede agora: tenta mais tarde */ }
}

$("btnAtualizar").addEventListener("click", () => location.reload());
window.setTimeout(() => void verificarVersao(), 3000);
window.setInterval(() => void verificarVersao(), 5 * 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) void verificarVersao(); });

// ---- Ajustes (brilho, qualidade, sensibilidade) ----

let ajustes: Ajustes = carregarAjustes();
let ajustesVoltarPara = "painelLobby";

// o brilho age só na imagem 3D (o canvas): textos e botões continuam como estão
function aplicarAjustes(): void {
  canvas.style.filter = ajustes.brilho === 1 ? "" : `brightness(${ajustes.brilho})`;
  renderer.definirQualidade(ajustes.qualidade);
  entrada.sensibilidade = ajustes.sensibilidade;
}

function mostrarControlesAjustes(): void {
  $<HTMLInputElement>("ajBrilho").value = String(Math.round(ajustes.brilho * 100));
  $("ajBrilhoValor").textContent = `${Math.round(ajustes.brilho * 100)}%`;
  $<HTMLSelectElement>("ajQualidade").value = ajustes.qualidade;
  $<HTMLInputElement>("ajSens").value = String(Math.round(ajustes.sensibilidade * 100));
  $("ajSensValor").textContent = `${Math.round(ajustes.sensibilidade * 100)}%`;
}

function abrirAjustes(): void {
  // durante a partida volta para a pausa; fora dela, para o lobby
  ajustesVoltarPara = rodando ? "painelPausa" : "painelLobby";
  if (rodando) entrada.soltar();
  mostrarControlesAjustes();
  mostrarPainel("painelAjustes");
}

function mudouAjuste(): void {
  const brilho = Number($<HTMLInputElement>("ajBrilho").value) / 100;
  const sens = Number($<HTMLInputElement>("ajSens").value) / 100;
  ajustes = {
    brilho: Math.min(LIMITES.brilho.max, Math.max(LIMITES.brilho.min, brilho)),
    qualidade: $<HTMLSelectElement>("ajQualidade").value as Qualidade,
    sensibilidade: Math.min(LIMITES.sensibilidade.max, Math.max(LIMITES.sensibilidade.min, sens)),
  };
  salvarAjustes(ajustes);
  aplicarAjustes();
  mostrarControlesAjustes();
}

for (const id of ["ajBrilho", "ajSens"]) $(id).addEventListener("input", mudouAjuste);
$("ajQualidade").addEventListener("change", mudouAjuste);
$("btnAjustesPadrao").addEventListener("click", () => {
  ajustes = ajustesPadrao();
  salvarAjustes(ajustes);
  aplicarAjustes();
  mostrarControlesAjustes();
});
$("btnAjustesVoltar").addEventListener("click", () => mostrarPainel(ajustesVoltarPara));
$("btnAjustes").addEventListener("click", abrirAjustes);
$("btnAjustesPausa").addEventListener("click", abrirAjustes);
aplicarAjustes();

// ---- Voltar ao início ----

function resetarParaInicio(): void {
  hostNet?.fechar();
  guestNet?.fechar();
  hostNet = null;
  guestNet = null;
  convidados.clear();
  window.clearTimeout(timerGrupo);
  conectandoGrupo = false;
  jogo = null;
  bots = [];
  modo = null;
  rodando = false;
  fimMostrado = false;
  fimInicio = 0;
  corpo = null;
  ultimaSnap = null;
  pendentes = [];
  saida = [];
  infos = [];
  entrada.soltar();
  document.body.classList.remove("jogando");
  hud.classList.add("hidden");
  $("toque").classList.add("hidden");
  renderer.definirJogadores([], 0);
  subtitulo.textContent = "online · 2 a 4 jogadores · 3D";
  btnConectar.disabled = false;
  mostrarPainel("painelLobby");
  renderLobby();
}

$("btnVoltarHost").addEventListener("click", resetarParaInicio);
$("btnVoltarCriar").addEventListener("click", resetarParaInicio);
$("btnVoltarJoin").addEventListener("click", resetarParaInicio);
$("btnSair").addEventListener("click", resetarParaInicio);
$("btnSairFim").addEventListener("click", resetarParaInicio);
$("btnRetomar").addEventListener("click", () => entrada.travar());

// ---- Host: criar sala ----

function atualizarListaHost(): void {
  if (!hostNet) return;
  const lista = hostNet.jogadores();
  statusHost.textContent = lista.length >= MAX_JOGADORES
    ? "Todos conectados! Pode iniciar."
    : `Aguardando jogadores... (${lista.length}/${MAX_JOGADORES})`;
  listaHost.innerHTML = listaHtml(lista, 0);
  btnIniciar.disabled = lista.length < 2;
}

$("btnHost").addEventListener("click", () => {
  convidados.clear();
  statusCriar.textContent = "";
  inputSenha.value = "";
  mostrarPainel("painelCriar");
  inputSenha.focus();
});

function criarSala(): void {
  const senha = normalizarCodigo(inputSenha.value);
  if (senha && senha.length < CODIGO_MIN) {
    statusCriar.textContent = `A senha precisa ter de ${CODIGO_MIN} a ${CODIGO_MAX} letras ou números.`;
    return;
  }
  mostrarPainel("painelHost");
  codigoHost.textContent = "----";
  statusHost.textContent = "Gerando sala...";
  listaHost.innerHTML = "";
  btnIniciar.disabled = true;

  hostNet = new HostNet(meuNome, senha, {
    aoAbrir: (codigo) => { codigoHost.textContent = codigo; atualizarListaHost(); },
    aoMudarLobby: () => {
      if (!hostNet || hostNet.iniciada) return;
      atualizarListaHost();
      hostNet.enviarLobby("lobby", hostNet.jogadores());
    },
    aoMensagem: (g, m) => {
      if (m.t === "cmds" && jogo) for (const c of m.cmds) jogo.aplicarComando(g.pid, c);
    },
    aoSair: (g) => jogo?.desconectar(g.pid),
    aoErro: (msg) => {
      if (msg === "unavailable-id") {
        // a senha já está em uso por outra sala: volta para escolher outra
        hostNet?.fechar();
        hostNet = null;
        statusCriar.textContent = `A senha "${senha}" já está em uso. Escolha outra.`;
        mostrarPainel("painelCriar");
      } else {
        statusHost.textContent = "Erro: " + msg;
      }
    },
  });
}

$("btnCriar").addEventListener("click", criarSala);
inputSenha.addEventListener("keydown", (e) => { if (e.key === "Enter") criarSala(); });
inputSenha.addEventListener("input", () => {
  const limpo = normalizarCodigo(inputSenha.value);
  if (limpo !== inputSenha.value) inputSenha.value = limpo;
});

btnIniciar.addEventListener("click", () => {
  if (!hostNet || hostNet.jogadores().length < 2) return;
  const players = hostNet.iniciar();
  iniciarPartida(players, 0, "host");
});

// ---- Convidado: entrar na sala ----

$("btnJoin").addEventListener("click", () => {
  mostrarPainel("painelJoin");
  statusJoin.textContent = "";
  listaJoin.innerHTML = "";
  inputCodigo.value = "";
  inputCodigo.focus();
});

function conectar(): void {
  const codigo = normalizarCodigo(inputCodigo.value);
  if (!codigo) return;
  statusJoin.textContent = "Conectando...";
  btnConectar.disabled = true;

  guestNet = new GuestNet(codigo, meuNome, {
    aoConectar: () => { statusJoin.textContent = "Conectado! Aguardando o host iniciar..."; },
    aoMensagem: aoMensagemHost,
    aoFechar: () => {
      if (!rodando) {
        statusJoin.textContent = "Conexão encerrada.";
        btnConectar.disabled = false;
        return;
      }
      perderConexao();
    },
    aoErro: (msg) => {
      btnConectar.disabled = false;
      statusJoin.textContent = msg === "peer-unavailable"
        ? "Sala não encontrada. Verifique a senha."
        : "Erro: " + msg;
    },
  });
}

// o host caiu no meio da partida
function perderConexao(): void {
  fimMostrado = true;
  entrada.soltar();
  $("msg").innerHTML = `<b style="color:var(--accent2)">Conexão perdida</b><br>O host encerrou ou saiu.`;
  listaFim.innerHTML = "";
  btnJogarDeNovo.hidden = true;
  abrirPainelFim();
}

$("btnConectar").addEventListener("click", conectar);
inputCodigo.addEventListener("keydown", (e) => { if (e.key === "Enter") conectar(); });

function aoMensagemHost(m: HostMsg): void {
  switch (m.t) {
    case "lobby":
      listaJoin.innerHTML = listaHtml(m.players, m.you);
      break;
    case "start":
      iniciarPartida(m.players, m.you, "guest");
      break;
    case "snap":
      ultimaSnap = m.s;
      reconciliar(m.s);
      break;
    case "shot":
      eventoTiro(m);
      break;
    case "kill":
      eventoAbate(m);
      break;
    case "boom":
      eventoExplosao(m);
      break;
  }
}

// ---- Início da partida ----

function iniciarPartida(players: PlayerInfo[], meuId: number, como: "host" | "guest" | "solo"): void {
  window.clearTimeout(timerGrupo);
  conectandoGrupo = false;
  modo = como;
  eu = meuId;
  infos = players;
  rodando = true;
  fimMostrado = false;
  fimInicio = 0;
  ultimaRodada = 0;
  corpo = null;
  ultimaSnap = null;
  pendentes = [];
  saida = [];
  seq = 0;
  entrada.yaw = SPAWNS[eu].yaw;
  entrada.pitch = 0;
  entrada.arma = 0;

  renderer.definirJogadores(players, eu);
  document.body.classList.add("jogando");
  hud.classList.remove("hidden");
  $("toque").classList.toggle("hidden", !entrada.toque);
  $("killfeed").innerHTML = "";
  subtitulo.textContent = como === "host" ? "você é o host" : como === "solo" ? "treino contra CPUs" : "conectado ao host";

  if (como !== "guest") {
    jogo = new HostGame(players);
    jogo.onShot = (m) => { eventoTiro(m); hostNet?.transmitir(m); };
    jogo.onKill = (m) => { eventoAbate(m); hostNet?.transmitir(m); };
    jogo.onBoom = (m) => { eventoExplosao(m); hostNet?.transmitir(m); };
    // se o navegador não conceder a captura do mouse, o jogador vê "Clique para jogar" e não o menu antigo
    mostrarPainel("painelPausa");
    entrada.travar();
  } else {
    jogo = null;
    mostrarPainel("painelPausa");
  }
}

btnJogarDeNovo.addEventListener("click", () => {
  if (modo === "guest" || !jogo) return;
  jogo.reiniciarPartida();
  fimMostrado = false;
  fimInicio = 0;
  ultimaRodada = 0;
  renderer.resetarRemotos();
  $("killfeed").innerHTML = "";
  hostNet?.reenviarInicio(infos);
  bots = bots.map((b) => new Bot(b.id, b.dificuldade));
  mostrarPainel("painelPausa");
  entrada.travar();
});

// ---- Predição e reconciliação (convidado) ----

function podeMover(s: Snapshot): boolean {
  const p = s.ps[eu];
  return s.phase !== "warmup" && !!p && p.alive;
}

function reconciliar(s: Snapshot): void {
  const p = s.ps[eu];
  if (!p) return;
  const c: Corpo = { x: p.x, y: p.y, z: p.z, vy: p.vy };
  pendentes = pendentes.filter((x) => x.seq > p.ack);
  if (podeMover(s)) for (const x of pendentes) moverCorpo(c, x);
  corpo = c;
}

// ---- Eventos de combate ----

function eventoTiro(m: ShotMsg): void {
  renderer.adicionarRastro(m.o, m.e);
  const dist = Math.hypot(m.o[0] - minhaPos[0], m.o[2] - minhaPos[2]);
  somTiro(Math.max(0.15, 1 - dist / 60), m.w === 1);

  if (m.i === eu) {
    renderer.disparoLocal(m.w);
    if (m.h >= 0) {
      somAcerto(m.hs);
      const hm = $("hitmarker");
      hm.classList.add("ativo");
      hm.classList.toggle("head", m.hs);
      setTimeout(() => hm.classList.remove("ativo"), 120);
    }
  } else if (m.h === eu) {
    somDano();
    const d = $("dano");
    d.classList.add("ativo");
    requestAnimationFrame(() => requestAnimationFrame(() => d.classList.remove("ativo")));
  }
}

function eventoExplosao(m: BoomMsg): void {
  renderer.explosao(m.x, m.y, m.z);
  const dist = Math.hypot(m.x - minhaPos[0], m.z - minhaPos[2]);
  somExplosao(Math.max(0.2, 1 - dist / 50));
}

function eventoAbate(m: KillMsg): void {
  const a = infos[m.killer];
  const v = infos[m.victim];
  if (!a || !v) return;
  if (m.victim === eu) somMorte();
  const linha = document.createElement("div");
  linha.innerHTML =
    `<span style="color:${a.cor}">${esc(a.nome)}</span> ${m.w === SLOT_GRANADA ? "💣" : "➜"} <span style="color:${v.cor}">${esc(v.nome)}</span>${m.head ? " ☠" : ""}`;
  $("killfeed").appendChild(linha);
  setTimeout(() => linha.remove(), 5000);
}

// ---- HUD ----

function nomeDe(id: number): string {
  return infos[id] ? esc(infos[id].nome) : "?";
}

function atualizarHud(s: Snapshot): void {
  const p = s.ps[eu];
  if (!p) return;

  definirHtml(
    $("placarTopo"),
    infos.map((i) => `<span style="color:${i.cor}">${esc(i.nome)} ${s.ps[i.id]?.wins ?? 0}</span>`).join(" · "),
  );

  const seg = Math.ceil(s.timer);
  definirHtml(
    $("relogio"),
    s.phase === "live" ? `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")} · primeiro a ${ROUNDS_PARA_VENCER}` : `round ${s.round}`,
  );

  let faixa = "";
  if (s.phase === "warmup") faixa = `Round ${s.round}<br>${seg}`;
  else if (s.phase === "roundEnd") {
    faixa = s.winner >= 0
      ? `<span style="color:${infos[s.winner]?.cor}">${nomeDe(s.winner)}</span> venceu o round`
      : "Empate";
  } else if (s.phase === "matchEnd") {
    faixa = infos[s.winner]
      ? `<span style="color:${infos[s.winner].cor}">${nomeDe(s.winner)}</span> venceu a partida`
      : "Fim de jogo";
  } else if (s.phase === "live" && !p.alive) faixa = `<span style="color:var(--accent2)">Você morreu</span>`;
  definirHtml($("faixa"), faixa);

  definirHtml($("vida"), String(Math.max(0, Math.ceil(p.hp))));
  const mun = $("municao");
  const sel = entrada.arma;
  const recarregando = p.reloading && sel === p.arma;
  mun.classList.toggle("recarregando", recarregando);
  if (sel === SLOT_GRANADA) definirHtml(mun, `💣 ${p.gr}`);
  else definirHtml(mun, recarregando ? "recarregando..." : `${p.am[sel]}/${ARMAS[sel].pente}`);

  definirHtml(
    $("armas"),
    NOMES_ARMAS.map((nome, i) => {
      const vazio = i === SLOT_GRANADA && p.gr <= 0;
      return `<span class="slot${i === sel ? " ativo" : ""}${vazio ? " vazio" : ""}" data-slot="${i}"><b>${i + 1}</b> ${nome}</span>`;
    }).join(""),
  );

  const tabela = $("tabela");
  tabela.classList.toggle("hidden", !entrada.placar);
  if (entrada.placar) {
    const linhas = [...s.ps]
      .sort((a, b) => b.wins - a.wins || b.kills - a.kills)
      .map((q) => {
        const i = infos[q.id];
        return `<tr><td style="color:${i.cor}">${esc(i.nome)}${q.on ? "" : " (saiu)"}</td><td>${q.wins}</td><td>${q.kills}</td><td>${q.deaths}</td></tr>`;
      })
      .join("");
    definirHtml(tabela, `<table><tr><th>Jogador</th><th>Rounds</th><th>Abates</th><th>Mortes</th></tr>${linhas}</table>`);
  }

  if (s.phase === "matchEnd" && !fimMostrado) {
    if (!fimInicio) fimInicio = performance.now();
    if (performance.now() - fimInicio >= ATRASO_FIM) mostrarFim(s);
  }
}

// abre o painel final com os botões travados por um instante: quem ainda está clicando
// para atirar não aperta "Voltar ao início" sem querer
function abrirPainelFim(): void {
  const botoes = [btnJogarDeNovo, $<HTMLButtonElement>("btnSairFim")];
  for (const b of botoes) b.disabled = true;
  mostrarPainel("painelFim");
  setTimeout(() => { for (const b of botoes) b.disabled = false; }, TRAVA_BOTOES_FIM);
}

function mostrarFim(s: Snapshot): void {
  fimMostrado = true;
  const w = infos[s.winner];
  $("msg").innerHTML = w
    ? `<b style="color:${w.cor}">${esc(w.nome)}</b> venceu a partida!`
    : "<b>Fim de jogo</b>";
  listaFim.innerHTML = [...s.ps]
    .sort((a, b) => b.wins - a.wins || b.kills - a.kills)
    .map((q) => `<div><span class="ponto" style="background:${infos[q.id].cor}"></span> ${esc(infos[q.id].nome)} · ${q.wins} rounds · ${q.kills} abates</div>`)
    .join("");
  btnJogarDeNovo.hidden = modo === "guest";
  btnJogarDeNovo.textContent = "Jogar de novo";
  entrada.soltar();
  abrirPainelFim();
}

// ---- Loop principal ----

const INTERVALO_SNAP = 1 / 20;
const INTERVALO_CMD = 1 / 30;
let armaVista = 0;
let acumSnap = 0;
let acumCmd = 0;
let anterior = performance.now();

function quadro(agora: number): void {
  const dt = Math.min((agora - anterior) / 1000, 0.05);
  anterior = agora;

  if (rodando) {
    const snapAtual = modo !== "guest" ? jogo!.snapshot() : ultimaSnap;

    if (snapAtual && snapAtual.round !== ultimaRodada) {
      ultimaRodada = snapAtual.round;
      entrada.yaw = SPAWNS[eu].yaw;
      entrada.pitch = 0;
      entrada.arma = 0;
      renderer.resetarRemotos();
    }

    const inp = entrada.ler();
    const cmd: Cmd = {
      seq: ++seq, dt, fwd: inp.fwd, strafe: inp.strafe, jump: inp.jump,
      yaw: entrada.yaw, pitch: entrada.pitch, fire: inp.fire, reload: inp.reload, arma: entrada.arma,
    };

    if (modo !== "guest" && jogo) {
      // no solo, o jogo pausa enquanto o mouse está solto (Esc)
      const pausado = modo === "solo" && !entrada.travado;
      if (!pausado) {
        jogo.aplicarComando(0, cmd);
        for (const b of bots) jogo.aplicarComando(b.id, b.pensar(dt, jogo));
        jogo.atualizar(dt);
      }
      acumSnap += dt;
      if (hostNet && acumSnap >= INTERVALO_SNAP) {
        acumSnap = 0;
        hostNet.transmitir({ t: "snap", s: jogo.snapshot() });
      }
    } else if (modo === "guest" && guestNet) {
      if (corpo && ultimaSnap && podeMover(ultimaSnap)) moverCorpo(corpo, cmd);
      pendentes.push(cmd);
      if (pendentes.length > 300) pendentes.shift();
      saida.push(cmd);
      acumCmd += dt;
      if (acumCmd >= INTERVALO_CMD) {
        acumCmd = 0;
        guestNet.enviar({ t: "cmds", cmds: saida });
        saida = [];
      }
    }

    const snap = modo !== "guest" ? jogo!.snapshot() : ultimaSnap;
    if (snap) {
      for (const p of snap.ps) if (p.id !== eu) renderer.atualizarRemoto(p);
      const meu = snap.ps[eu];
      if (meu && meu.gr <= 0 && entrada.arma === SLOT_GRANADA) entrada.arma = 0;
      if (entrada.arma !== armaVista) {
        armaVista = entrada.arma;
        renderer.definirArma(armaVista);
      }
      renderer.atualizarGranadas(snap.gs);
      const pos = modo === "guest" && corpo ? corpo : meu;
      if (pos && meu) {
        minhaPos = [pos.x, pos.y, pos.z];
        renderer.posicionarCamera(pos.x, pos.y, pos.z, entrada.yaw, entrada.pitch, meu.alive);
      }
      atualizarHud(snap);
    }
  }

  renderer.ativarLobby(!rodando);
  renderer.desenhar(dt);
  requestAnimationFrame(quadro);
}

amigos.iniciar();
renderAmigos();
renderLobby();
window.setInterval(() => grupo.sincronizar(), 5000);
mostrarPainel(meuNome ? "painelLobby" : "painelNome");

// o link vale ao abrir a página e também ao colá-lo numa aba onde o jogo já está aberto (só muda o #)
function tratarLinkRecebido(): void {
  const link = lerLinkRecebido();
  if (!link || link.apelido === amigos.apelido) return;
  mostrarAviso(
    `${link.apelido} te chamou para jogar${link.sala ? " numa sala" : ""}`,
    "Aceitar",
    () => aceitarLink(link),
    10 * 60000,
  );
}
tratarLinkRecebido();
window.addEventListener("hashchange", tratarLinkRecebido);
requestAnimationFrame(quadro);
