import * as THREE from "three";
import "./style.css";
import { Terreno } from "./terreno";
import { Retroescavadeira, LIMITES, Concha } from "./maquina";
import { montarCenario, VALA } from "./cenario";
import { limitar, LOTES } from "./mapa";
import { Caminhao } from "./caminhao";
import { Particulas } from "./particulas";
import { Som } from "./som";
import { Manche, botaoSegurar, ehToque } from "./toque";
import { Operario } from "./operario";
import { alternarTelaCheia, entrarTelaCheia, instalado } from "./tela";
import { ajustes, ligarMenuAjustes } from "./ajustes";
import { Voz } from "./voz";
import type { MediaConnection } from "peerjs";
import { Anfitriao, Convidado, Msg, Ligado, normalizarPalavra, palavraAleatoria } from "./rede";
import { personagemValido, urlPersonagem } from "./personagens";
import { Elenco, DadosJogador, mmParaBuffer, bufferParaMm, mmParaTexto, textoParaMm } from "./elenco";
import { Bloco, Empurrao, caixa, circulo, contem, dentro, empurrar, caixasSeCruzam, caixaECirculo } from "./colisao";

const TOQUE = ehToque();
if (TOQUE) document.body.classList.add("toque");

// ---------------- cena ----------------
const canvas = document.getElementById("cena") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, TOQUE ? 1.5 : 2)); // celular: menos pixels, mais quadros
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
const terreno = new Terreno();
const { sol, caminhao, arvores, favela } = montarCenario(cena, terreno);
const maq = new Retroescavadeira();
cena.add(maq.raiz);
const particulas = new Particulas();
cena.add(particulas.malha);
const som = new Som();
const op = new Operario();
cena.add(op.grupo);
let meuPersonagem = "operario"; // escolhido no menu (guardado no navegador)
try {
  meuPersonagem = personagemValido(localStorage.getItem("retro-personagem"));
} catch {
  /* ignora */
}
void op.carregar(urlPersonagem(meuPersonagem));
const elenco = new Elenco(cena, maq.banco, caminhao.banco, urlPersonagem); // os outros jogadores da sala
// mira: mostra no chão (ou na caçamba) onde a terra da concha traseira vai cair
const mira = new THREE.Mesh(
  new THREE.RingGeometry(0.32, 0.44, 28).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: "#ffd34d", transparent: true, opacity: 0.85, depthWrite: false }),
);
mira.renderOrder = 2;
cena.add(mira);

function redimensionar(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", redimensionar);
redimensionar();

// ---------------- estado ----------------
type Modo = "dirigir" | "escavar";
let modo: Modo = "dirigir";
const carro = { x: 0, z: 20, rumo: 0, vel: 0, esterco: 0, y: 0, arfagem: 0, rolagem: 0 };
const carroCam = { x: 4.9, z: 7.6, rumo: 0, vel: 0, esterco: 0, y: 0, arfagem: 0, rolagem: 0 }; // pose do caminhão
// velocidade atual de cada articulação (o hidráulico acelera e freia suave)
const taxa: Record<string, number> = { giro: 0, lanca: 0, braco: 0, concha: 0, bracoFrente: 0, conchaFrente: 0 };
const VEL_JUNTA: Record<string, number> = { giro: 0.75, lanca: 0.55, braco: 0.75, concha: 1.1, bracoFrente: 0.45, conchaFrente: 0.9 };
let jogando = false;
let cameraCabine = false;
let progresso = 0;
let valaPronta = false;
let tempoMissao = 0;
let somTerra = 0;
let aPe = true; // o jogo começa com o operário fora da máquina
let pedirPulo = false;
// sala: solo, anfitrião (roda a obra) ou convidado (anda, dirige e cava pelo anfitrião)
type Papel = "solo" | "anfitriao" | "convidado";
let papel: Papel = "solo";
const UID_ANFITRIAO = "anfitriao";
let meuUid = UID_ANFITRIAO; // o convidado usa uma identidade guardada no navegador
let meuNome = "Operário";
let condutor = ""; // quem está sentado na cabine da máquina ("" = ninguém); só uma pessoa opera cada veículo
let condutorCam = ""; // idem, no caminhão
// em qual veículo estou sentado (vale quando não estou a pé)
type Veiculo = "maq" | "cam";
let veiculo: Veiculo = "maq";
// durante o jogo, fechar a aba (Ctrl+W por engano) pede confirmação
addEventListener("beforeunload", (e) => {
  if (jogando) e.preventDefault();
});

// ---------------- entrada ----------------
const teclas = new Set<string>();
addEventListener("keydown", (e) => {
  if (!jogando) return;
  if (!$("ajustes").classList.contains("escondido")) {
    // com o menu de ajustes aberto, as teclas não mexem no jogo
    if (e.code === "KeyO" || e.code === "Escape") alternarAjustes(false);
    return;
  }
  if (e.code === "Tab") {
    e.preventDefault();
    if (!aPe) trocarModo();
  } else if (e.code === "KeyE" && !e.repeat) entrarOuSair();
  else if (aPe && (e.code === "ControlLeft" || e.code === "ControlRight")) e.preventDefault(); // agachar: vale enquanto segura (ver agachandoTeclado)
  else if (aPe && e.code === "Space" && !e.repeat) pedirPulo = true;
  else if (e.code === "KeyC" && !aPe) cameraCabine = !cameraCabine;
  else if (e.code === "KeyO") alternarAjustes();
  else if (e.code === "KeyH") alternarPainel("ajuda", "recolhida");
  else if (e.code === "KeyN") alternarPainel("painel-missao", "recolhido");
  else if (e.code === "KeyM") som.ligado = !som.ligado;
  else if (e.code === "KeyV" && !e.repeat && papel !== "solo") void alternarMic();
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  teclas.add(e.code);
});
addEventListener("keyup", (e) => teclas.delete(e.code));
addEventListener("blur", () => teclas.clear());
const k = (c: string) => (teclas.has(c) ? 1 : 0);
// Ctrl (ou C, que não fecha a aba como Ctrl+W) agacha enquanto estiver pressionado
const agachandoTeclado = (): boolean => teclas.has("ControlLeft") || teclas.has("ControlRight") || teclas.has("KeyC");


let botaoYAntes = false;
let botaoAAntes = false;
let botaoXAntes = false;
function controle(): Gamepad | null {
  for (const g of navigator.getGamepads?.() ?? []) if (g && g.connected) return g;
  return null;
}
const zona = (v: number) => (Math.abs(v) < ajustes.zona ? 0 : (v - Math.sign(v) * ajustes.zona) / (1 - ajustes.zona));
const sinalY = () => (ajustes.invertY ? -1 : 1); // câmera vertical invertida

// câmera orbital: arrastar (mouse ou dedo) gira, rodinha ou pinça com dois dedos aproxima
const orbita = { yaw: 0, pitch: 0.38, dist: 15 };
const dedos = new Map<number, { x: number; y: number }>();
let pinca = 0;
// no computador o mouse fica preso no jogo (pointer lock): mexer gira a câmera sem clicar; Esc solta
const mousePreso = () => document.pointerLockElement === canvas;
function prenderMouse(): void {
  if (TOQUE || !jogando || mousePreso()) return;
  try {
    const p = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {}); // o navegador recusa logo depois de um Esc: é só clicar de novo
  } catch {
    /* sem pointer lock */
  }
}
document.addEventListener("mousemove", (e) => {
  if (!mousePreso()) return;
  orbita.yaw -= e.movementX * 0.0035 * ajustes.mouse;
  orbita.pitch = THREE.MathUtils.clamp(orbita.pitch + e.movementY * 0.0028 * ajustes.mouse * sinalY(), cameraCabine ? -0.8 : -0.85, cameraCabine ? 0.8 : 1.35);
});
document.addEventListener("pointerlockchange", () => {
  document.body.classList.toggle("mouse-preso", mousePreso());
  if (!mousePreso()) dedos.clear();
});
canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && !TOQUE) {
    prenderMouse();
    if (mousePreso()) return; // preso: a câmera segue o mouse sem arrastar
  }
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* ponteiro já inativo */
  }
  pinca = 0;
});
const soltarDedo = (e: PointerEvent) => {
  dedos.delete(e.pointerId);
  pinca = 0;
};
canvas.addEventListener("pointerup", soltarDedo);
canvas.addEventListener("pointercancel", soltarDedo);
canvas.addEventListener("pointermove", (e) => {
  const antes = dedos.get(e.pointerId);
  if (!antes || mousePreso()) return;
  const dx = e.clientX - antes.x;
  const dy = e.clientY - antes.y;
  antes.x = e.clientX;
  antes.y = e.clientY;
  if (dedos.size >= 2) {
    const [a, b] = [...dedos.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinca > 0) orbita.dist = THREE.MathUtils.clamp(orbita.dist * (pinca / d) ** ajustes.zoom, 5, 40);
    pinca = d;
    return;
  }
  const k = e.pointerType === "touch" ? 0.008 * ajustes.toque : 0.005 * ajustes.mouse;
  orbita.yaw -= dx * k;
  orbita.pitch = THREE.MathUtils.clamp(orbita.pitch + dy * k * 0.8 * sinalY(), cameraCabine ? -0.8 : -0.85, cameraCabine ? 0.8 : 1.35);
});
canvas.addEventListener("wheel", (e) => {
  orbita.dist = THREE.MathUtils.clamp(orbita.dist * (1 + Math.sign(e.deltaY) * 0.1 * ajustes.zoom), 5, 40);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------------- HUD ----------------
const $ = (id: string) => document.getElementById(id)!;

// painéis que recolhem (missão e comandos); a escolha fica guardada no navegador
function alternarPainel(id: string, classe: string, recolher?: boolean): void {
  const el = $(id);
  const agora = el.classList.toggle(classe, recolher);
  $("bt-missao").textContent = $("painel-missao").classList.contains("recolhido") ? "+" : "–";
  try {
    localStorage.setItem(`retro-${id}`, agora ? "1" : "0");
  } catch {
    /* ignora */
  }
}
function lembrarPainel(id: string, classe: string, padrao: boolean): void {
  let v: string | null = null;
  try {
    v = localStorage.getItem(`retro-${id}`);
  } catch {
    /* ignora */
  }
  alternarPainel(id, classe, v === null ? padrao : v === "1");
}
const AJUDA_PE = `<div class="titulo">🚶 A pé</div>
    <b>W A S D</b> andar<br><b>Shift</b> correr<br><b>Ctrl</b> ou <b>C</b> agachar (segurando) · correndo (Shift, pode soltar) e apertando Ctrl/C = carrinho · pular e Ctrl logo depois = prolonga o carrinho<br><b>Espaço</b> pular (encostado: escalar)<br><b>E</b> entrar na retroescavadeira (porta da cabine)<br>
    <div class="rodape">mouse gira a câmera · <b>Esc</b> solta o mouse · <b>M</b> som · <b>V</b> microfone</div>`;
const AJUDA: Record<Modo, string> = {
  dirigir: `<div class="titulo">🚗 Dirigir</div>
    <b>W / S</b> acelerar / ré<br><b>A / D</b> virar<br><b>Espaço</b> freio<br>
    <b>R / F</b> sobe / desce a pá da frente<br><b>T / G</b> recolhe / despeja a pá<br>
    <div class="rodape"><b>Tab</b> parar e escavar · <b>E</b> sair · <b>C</b> câmera · <b>M</b> som · <b>V</b> microfone</div>`,
  escavar: `<div class="titulo">⛏️ Escavar (braço traseiro)</div>
    <b>W / S</b> sobe / desce a lança<br><b>A / D</b> gira para a esquerda / direita<br>
    <b>↑ / ↓</b> ou <b>I / K</b> estica / recolhe o braço<br><b>← / →</b> ou <b>J / L</b> fecha / abre a concha<br>
    <div class="rodape"><b>Tab</b> dirigir · <b>E</b> sair · <b>C</b> câmera · <b>M</b> som · <b>V</b> microfone</div>`,
};
const AJUDA_CAM = `<div class="titulo">🚚 Caminhão</div>
    <b>W / S</b> acelerar / ré<br><b>A / D</b> virar<br><b>Espaço</b> freio<br>
    <b>R / F</b> levanta / abaixa a caçamba<br>
    <div class="rodape"><b>E</b> sair · <b>C</b> câmera · <b>M</b> som · <b>V</b> microfone</div>`;
let avisoTempo = 0;
function aviso(texto: string, segundos = 2.2): void {
  $("aviso").textContent = texto;
  $("aviso").classList.remove("escondido");
  avisoTempo = segundos;
}

function trocarModo(): void {
  if (aPe || veiculo === "cam") return;
  if (modo === "dirigir" && Math.abs(carro.vel) > 0.6) {
    aviso("Pare a máquina antes de escavar");
    return;
  }
  if (papel === "convidado") {
    convidado?.enviar({ t: "modo" }); // o anfitrião troca e o novo modo volta no próximo quadro da rede
    return;
  }
  definirModo(modo === "dirigir" ? "escavar" : "dirigir");
}

function definirModo(novo: Modo): void {
  if (novo === modo) return;
  modo = novo;
  if (condutor === meuUid) {
    // a câmera só muda para quem está operando
    if (modo === "escavar") {
      // de lado e um pouco atrás: a pá da frente não tampa o braço
      orbita.yaw = 0.75;
      orbita.pitch = 0.5;
      orbita.dist = 11;
    } else {
      orbita.yaw = 0;
      orbita.pitch = 0.38;
      orbita.dist = 15;
    }
  }
  atualizarTextos();
}

function atualizarTextos(): void {
  const emCam = !aPe && veiculo === "cam";
  $("modo").textContent = aPe ? "🚶 A pé" : emCam ? "🚚 Dirigindo o caminhão" : modo === "dirigir" ? "🚗 Dirigindo" : "⛏️ Escavando";
  $("ajuda").innerHTML = aPe ? AJUDA_PE : emCam ? AJUDA_CAM : AJUDA[modo];
  document.body.classList.toggle("a-pe", aPe);
  document.body.classList.toggle("em-caminhao", emCam);
  $("bt-entrar").textContent = aPe ? "🚜 Entrar" : "🚶 Sair";
  rotularToque();
}

// ---------------- operário: entrar e sair da cabine ----------------
// ponto do corpo de um veículo (x, z) no mundo
type Pose = { x: number; z: number; rumo: number; y: number; vel: number; esterco: number; arfagem: number; rolagem: number };
const poseDe = (v: Veiculo): Pose => (v === "maq" ? carro : carroCam);
const condutorDe = (v: Veiculo): string => (v === "maq" ? condutor : condutorCam);
function definirCondutorDe(v: Veiculo, uid: string): void {
  if (v === "maq") condutor = uid;
  else condutorCam = uid;
}
const portaDe = (v: Veiculo): { x: number; z: number } => (v === "maq" ? maq.porta : caminhao.porta);
const bancoDe = (v: Veiculo): THREE.Object3D => (v === "maq" ? maq.banco : caminhao.banco);

function noCorpo(v: Veiculo, x: number, z: number): { x: number; z: number } {
  const p = poseDe(v);
  const s = Math.sin(p.rumo);
  const c = Math.cos(p.rumo);
  return { x: p.x + x * c + z * s, z: p.z - x * s + z * c };
}

// ponto do corpo da máquina (x, z) no mundo
function corpoParaMundo(x: number, z: number): { x: number; z: number } {
  return noCorpo("maq", x, z);
}

// o veículo cuja porta está ao alcance de quem está a pé (a retroescavadeira tem preferência)
function veiculoPerto(): Veiculo | null {
  for (const v of ["maq", "cam"] as Veiculo[]) {
    const porta = portaDe(v);
    const p = noCorpo(v, porta.x + 0.4, porta.z);
    if (Math.hypot(op.x - p.x, op.z - p.z) < 1.9) return v;
  }
  return null;
}

const NOME_VEICULO: Record<Veiculo, string> = { maq: "retroescavadeira", cam: "caminhão" };

function entrarOuSair(): void {
  if (!jogando) return;
  if (aPe) {
    const v = veiculoPerto();
    if (!v) {
      aviso("Chegue perto da porta de um veículo (lado esquerdo) para entrar");
      return;
    }
    if (condutorDe(v) !== "") {
      aviso(`Outro operário está ${v === "maq" ? "na" : "no"} ${NOME_VEICULO[v]}`);
      return;
    }
    if (papel === "convidado") {
      convidado?.enviar({ t: "entrar", v }); // o anfitrião confirma e o convidado senta quando a rede avisar
      return;
    }
    definirCondutorDe(v, meuUid);
    sentar(v);
  } else {
    if (Math.abs(poseDe(veiculo).vel) > 0.8) {
      aviso(veiculo === "maq" ? "Pare a máquina antes de sair" : "Pare o caminhão antes de sair");
      return;
    }
    if (papel === "convidado") {
      convidado?.enviar({ t: "sair" });
      return;
    }
    definirCondutorDe(veiculo, "");
    levantar();
  }
}

function sentar(v: Veiculo): void {
  aPe = false;
  veiculo = v;
  op.agachado = false;
  op.noChao = true;
  op.vy = 0;
  // senta no banco (o banco da retroescavadeira gira junto quando escava)
  bancoDe(v).add(op.grupo);
  op.grupo.position.set(0, -0.25, 0);
  op.grupo.rotation.set(0, 0, 0);
  op.vel = 0;
  op.tocar("sentado", 0.3);
  if (v === "cam") {
    orbita.yaw = 0;
    orbita.pitch = 0.35;
    orbita.dist = 18;
    aviso(TOQUE ? "No caminhão: manche esquerdo dirige, FREIO para parar" : "No caminhão: W/S acelera, A/D vira, Espaço freia", 3);
  } else {
    orbita.yaw = modo === "escavar" ? 0.75 : 0;
    orbita.pitch = modo === "escavar" ? 0.5 : 0.38;
    orbita.dist = modo === "escavar" ? 11 : 15;
    aviso(modo === "escavar" ? "Na cabine: escavando" : TOQUE ? "Na cabine: dê ré até a vala e toque em ⛏️ Escavar" : "Na cabine: dê ré até a vala e aperte Tab para escavar", 3);
  }
  atualizarTextos();
}

function levantar(): void {
  aPe = true;
  cameraCabine = false;
  const porta = portaDe(veiculo);
  const p = noCorpo(veiculo, porta.x + 0.6, porta.z);
  op.x = p.x;
  op.z = p.z;
  op.rumo = poseDe(veiculo).rumo + Math.PI / 2; // de costas para a porta
  op.y = terreno.altura(op.x, op.z);
  op.noChao = true;
  cena.add(op.grupo);
  op.grupo.visible = true;
  op.tocar("parado", 0.3);
  orbita.yaw = op.rumo + Math.PI;
  orbita.pitch = 0.3;
  orbita.dist = 6;
  atualizarTextos();
}

// ---------------- colisões ----------------
// blocos da máquina no mundo: peças fixas (no corpo dela) + pá da frente e braço traseiro, que se mexem
function blocosMaquina(): Bloco[] {
  const B = (cx: number, cz: number, hx: number, hz: number, y0: number, y1: number) => {
    const p = corpoParaMundo(cx, cz);
    return caixa(p.x, p.z, carro.rumo, hx, hz, carro.y + y0, carro.y + y1);
  };
  const esc = corpoParaMundo(-0.35, 1.7);
  const lista = [
    circulo(esc.x, esc.z, 0.1, carro.y + 2.05, carro.y + 2.95), // tubo de escape (em cima do capô)
    B(0, 0.1, 0.8, 2.2, 0, 1.25), // chassi entre as rodas
    B(1.05, -0.9, 0.28, 0.86, 0, 1.65), // roda traseira + para-lama (dá para subir)
    B(-1.05, -0.9, 0.28, 0.86, 0, 1.65),
    B(0.92, 1.75, 0.2, 0.55, 0, 1.15), // roda dianteira + para-lama
    B(-0.92, 1.75, 0.2, 0.55, 0, 1.15),
    B(0, 1.35, 0.6, 0.9, 0, 2.12), // capô
    B(0, -0.75, 0.93, 1.03, 0, 3.26), // cabine (teto)
    B(0, -2.1, 0.85, 0.42, 0, 1.87), // traseira e suporte do braço
  ];
  // pá da frente (dá para subir nela) e os dois braços dela
  const pa = maq.conchaFrenteG.localToWorld(new THREE.Vector3(0, -0.05, 0.45));
  lista.push(caixa(pa.x, pa.z, carro.rumo, 1.18, 0.5, pa.y - 0.42, pa.y + 0.45));
  for (const lado of [-1, 1]) {
    for (let f = 0.1; f <= 0.95; f += 0.2) {
      const q = maq.bracoFrenteG.localToWorld(new THREE.Vector3(lado * 1.08, -0.6 * f, 0.3 + 2.9 * f));
      lista.push(circulo(q.x, q.z, 0.13, q.y - 0.16, q.y + 0.16));
    }
  }
  // braço traseiro: lança, braço e concha como uma fila de cilindros
  for (let u = 0.3; u <= 2.7; u += 0.4) {
    const q = maq.lancaG.localToWorld(new THREE.Vector3(0, 0.2 + 0.3 * Math.sin((Math.PI * u) / 2.88), -u));
    lista.push(circulo(q.x, q.z, 0.22, q.y - 0.3, q.y + 0.3));
  }
  for (let u = 0; u <= 2.0; u += 0.5) {
    const q = maq.bracoG.localToWorld(new THREE.Vector3(0, 0, -u));
    lista.push(circulo(q.x, q.z, 0.16, q.y - 0.22, q.y + 0.22));
  }
  const cb = maq.conchaG.localToWorld(new THREE.Vector3(0, 0.2, -0.5));
  lista.push(circulo(cb.x, cb.z, 0.42, cb.y - 0.4, cb.y + 0.4));
  return lista;
}

// altura em que o operário fica em pé em (x, z): o chão ou o topo de um bloco que não esteja acima de yMax
function apoio(blocos: Bloco[], x: number, z: number, yMax: number): number {
  let a = terreno.altura(x, z);
  for (const b of blocos) if (b.y1 <= yMax && b.y1 > a && contem(b, x, z)) a = b.y1;
  return a;
}

// ---------------- operário a pé: andar, pular e escalar ----------------
const RAIO_OP = 0.3;
const DEGRAU = 0.4; // sobe sozinho o que tiver até essa altura
const ALCANCE = 2.75; // escala o que tiver até essa altura acima dos pés
let escalada: { t: number; dur: number; x0: number; z0: number; y0: number; x1: number; z1: number; y1: number } | null = null;
let podeEscalar = false;
let montado: "" | Veiculo = ""; // em pé em cima de um veículo (anda junto com ele)

// procura onde o operário iria parar se escalasse o bloco em que encostou; null se alto demais ou sem lugar em cima
function alvoEscalada(blocos: Bloco[], e: Empurrao): { x: number; z: number; y: number } | null {
  const topoBloco = Math.max(...blocos.filter((b) => contem(b, e.bx - e.nx * 0.05, e.bz - e.nz * 0.05) && b.y1 > op.y + DEGRAU).map((b) => b.y1), -Infinity);
  if (!isFinite(topoBloco) || topoBloco - op.y > ALCANCE) return null;
  const altura = op.agachado ? 1.15 : 1.75;
  // tenta parar bem para dentro do topo; em lugar estreito (para-lama ao lado da cabine) fica mais na beirada
  for (const fundo of [0.55, 0.4, 0.28, 0.16]) {
    const x = e.bx - e.nx * fundo;
    const z = e.bz - e.nz * fundo;
    const y = apoio(blocos, x, z, topoBloco + 0.5);
    if (y - op.y <= DEGRAU || y - op.y > ALCANCE) continue;
    const livre = blocos.every((b) => !(b.y0 < y + altura && b.y1 > y + DEGRAU && empurrar(b, x, z, 0.2)));
    if (livre) return { x, z, y };
  }
  return null;
}

// carrinho: correndo e apertando Ctrl/C, o operário escorrega como no futebol: arranque maior que o de correr, que perde força
// até parar de arrastar na distância máxima (a direção fica travada e não precisa segurar a tecla). Depois ele se levanta.
// Combo: pular durante o carrinho (ou logo depois) guarda o impulso no ar; apertar Ctrl/C em seguida (no ar ou logo depois
// de pousar) prolonga o carrinho, saindo do pouso com o impulso. Só um prolongamento por carrinho.
const CARRINHO_DIST = 5; // m
const CARRINHO_VEL0 = 8.6; // m/s no início (correr = 4,2)
const CARRINHO_VEL1 = 3.2; // m/s no fim
const CARRINHO_ESPERA = 1.2; // s até poder fazer outro
const PROLONGADO_DIST = 4.5; // m do carrinho prolongado
const PROLONGADO_VEL0 = 6.5; // m/s mínimos na saída do pouso
const IMPULSO_JANELA = 0.5; // s depois do carrinho em que o pulo ainda guarda o impulso
const SALTO_JANELA = 1.5; // s depois do pulo em que o Ctrl/C ainda prolonga (o pulo dura ~0,9 s)
let carrinho: { dist: number; max: number; v0: number; prolongado: boolean } | null = null;
let esperaCarrinho = 0;
let aposCarrinho = 0; // s que restam, depois do fim do carrinho, para o pulo guardar o impulso
let salto: { vel: number; t: number } | null = null; // pulo feito durante/logo depois do carrinho
let prolongar = false; // Ctrl/C apertado no ar: ao pousar, o carrinho continua
let agachouAntes = false;

// o Shift continua "apertado" por um instante depois de solto: dá tempo de apertar o Ctrl/C com o mesmo dedo e fazer o carrinho
const SHIFT_RESIDUAL = 0.5; // s
let shiftResidual = 0;

function andarAPe(dt: number, frente: number, lado: number, shift: boolean, agachar: boolean, pular: boolean): void {
  // escalando: a animação leva o operário para cima e depois para dentro do topo
  if (escalada) {
    const e = escalada;
    e.t += dt / e.dur;
    const t = Math.min(1, e.t);
    if (t < 0.7) {
      const k = t / 0.7;
      op.y = e.y0 + (e.y1 - e.y0) * (k * k * (3 - 2 * k));
      op.tocar("escalar", 0.15, 1.4);
    } else {
      const k = (t - 0.7) / 0.3;
      op.y = e.y1;
      op.x = e.x0 + (e.x1 - e.x0) * k;
      op.z = e.z0 + (e.z1 - e.z0) * k;
      op.tocar("agachado", 0.2);
    }
    if (e.t >= 1) {
      escalada = null;
      op.noChao = true;
      op.vy = 0;
    }
    op.grupo.position.set(op.x, op.y, op.z);
    op.grupo.rotation.y = op.rumo;
    montado = "";
    return;
  }

  shiftResidual = shift ? SHIFT_RESIDUAL : Math.max(0, shiftResidual - dt);
  const correr = shift || shiftResidual > 0;
  const yaw = orbita.yaw;
  let dx = -Math.sin(yaw) * frente + Math.cos(yaw) * lado;
  let dz = -Math.cos(yaw) * frente - Math.sin(yaw) * lado;
  const forca = Math.min(1, Math.hypot(dx, dz));
  esperaCarrinho = Math.max(0, esperaCarrinho - dt);
  aposCarrinho = Math.max(0, aposCarrinho - dt);
  if (salto) {
    salto.t -= dt;
    if (salto.t <= 0) {
      salto = null;
      prolongar = false;
    }
  }
  if (carrinho && !op.noChao) fimCarrinho(false);
  const apertou = agachar && !agachouAntes;
  agachouAntes = agachar;
  if (apertou && !carrinho) {
    if (salto) prolongar = true; // pulo do combo: continua o carrinho ao pousar (ou já, se já pousou)
    // correndo (Shift segurado, ou solto há menos de meio segundo): o agachar vira carrinho
    else if (correr && forca > 0.05 && op.vel > 2.8 && op.noChao && esperaCarrinho === 0) carrinho = { dist: 0, max: CARRINHO_DIST, v0: CARRINHO_VEL0, prolongado: false };
  }
  if (prolongar && salto && op.noChao && !carrinho) {
    carrinho = { dist: 0, max: PROLONGADO_DIST, v0: Math.max(salto.vel, PROLONGADO_VEL0), prolongado: true };
    salto = null;
    prolongar = false;
  }
  op.agachado = agachar || carrinho !== null;
  // agachado anda devagar; agachado com Shift anda rápido
  const maxima = op.agachado ? (correr ? 2.6 : 0.9) : correr ? 4.2 : 1.7;
  const alvo = forca > 0.05 ? maxima * forca : 0;
  const x0 = op.x;
  const z0 = op.z;
  if (carrinho) op.vel = carrinho.v0 + (CARRINHO_VEL1 - carrinho.v0) * Math.min(1, carrinho.dist / carrinho.max);
  else if (salto && !op.noChao) op.vel = Math.max(op.vel, salto.vel); // no pulo do combo o impulso se mantém
  // no ar dá para corrigir um pouco a direção, mas não frear de repente
  else op.vel += (alvo - op.vel) * Math.min(1, dt * (op.noChao ? 8 : 1.5));
  if (forca > 0.05 && !carrinho) {
    const n = Math.hypot(dx, dz);
    dx /= n;
    dz /= n;
    let dif = Math.atan2(dx, dz) - op.rumo;
    dif = Math.atan2(Math.sin(dif), Math.cos(dif));
    op.rumo += dif * Math.min(1, dt * (op.noChao ? 10 : 3));
  }
  op.x += Math.sin(op.rumo) * op.vel * dt;
  op.z += Math.cos(op.rumo) * op.vel * dt;
  [op.x, op.z] = limitar(op.x, op.z, 4);

  // empurra para fora de tudo que estiver na altura do corpo (o que for baixinho ele sobe: degrau)
  const blocosMaq = blocosMaquina();
  const blocosCam = caminhao.blocos();
  const blocos = [...blocosMaq, ...blocosCam, ...arvores, ...favela.perto(op.x, op.z)];
  const altura = op.agachado ? 1.15 : 1.75;
  let encosto: Empurrao | null = null;
  for (let passo = 0; passo < 2; passo++) {
    for (const b of blocos) {
      if (b.y1 <= op.y + DEGRAU || b.y0 >= op.y + altura) continue;
      const e = empurrar(b, op.x, op.z, RAIO_OP);
      if (!e) continue;
      op.x = e.x;
      op.z = e.z;
      if (b.escalavel) encosto = e;
    }
  }
  if (carrinho) {
    // a escorregada acaba ao chegar na distância máxima ou ao bater em algo
    const andou = Math.hypot(op.x - x0, op.z - z0);
    carrinho.dist += andou;
    if (carrinho.dist >= carrinho.max || andou < op.vel * dt * 0.5) fimCarrinho(false);
  }

  // escalar: encostado em algo alcançável, o pulo vira escalada
  const alvoEsc = encosto ? alvoEscalada(blocos, encosto) : null;
  podeEscalar = !!alvoEsc;
  if (pular && alvoEsc && encosto) {
    carrinho = null;
    salto = null;
    op.agachado = false;
    op.vel = 0;
    op.rumo = Math.atan2(-encosto.nx, -encosto.nz); // de frente para a parede
    escalada = { t: 0, dur: 0.45 + (alvoEsc.y - op.y) * 0.35, x0: op.x, z0: op.z, y0: op.y, x1: alvoEsc.x, z1: alvoEsc.z, y1: alvoEsc.y };
    return;
  }
  if (pular && op.noChao) {
    // pulo durante o carrinho (ou logo depois): guarda o impulso para o combo
    if ((carrinho && !carrinho.prolongado) || aposCarrinho > 0) {
      salto = { vel: Math.max(op.vel, 5.5), t: SALTO_JANELA };
      prolongar = false;
    }
    if (carrinho) fimCarrinho(true);
    op.noChao = false;
    op.vy = 4.6;
  }

  // altura: em pé no chão ou em cima de algo; no ar (pulo, ou saiu da beirada) a gravidade puxa
  if (op.noChao) {
    const a = apoio(blocos, op.x, op.z, op.y + DEGRAU);
    if (a < op.y - 0.3) {
      op.noChao = false; // pisou no vazio (beirada da vala, do teto da cabine...)
      op.vy = 0;
    } else op.y = a;
  }
  if (!op.noChao) {
    const antes = op.y;
    op.vy -= 9.8 * dt;
    op.y += op.vy * dt;
    const a = apoio(blocos, op.x, op.z, antes + 0.05);
    if (op.y <= a) {
      op.y = a;
      op.vy = 0;
      op.noChao = true;
    }
  }
  // em pé no topo de uma peça de um veículo (e não no chão): ele leva o operário junto
  const sobre = (lista: Bloco[]): boolean => lista.some((b) => Math.abs(b.y1 - op.y) < 0.06 && b.y1 > terreno.altura(op.x, op.z) + 0.2 && contem(b, op.x, op.z));
  montado = !op.noChao ? "" : sobre(blocosMaq) ? "maq" : sobre(blocosCam) ? "cam" : "";
  op.grupo.position.set(op.x, op.y, op.z);
  op.grupo.rotation.y = op.rumo;
  if (!op.noChao) op.tocar("pulo", 0.15);
  else if (carrinho) op.tocar("carrinho", 0.1);
  else if (op.agachado) op.tocar(op.vel < 0.15 ? "agachado" : "agachado_andar", 0.25, op.vel < 0.15 ? 1 : Math.min(op.vel / 0.8, 3.2));
  else if (op.vel < 0.15) op.tocar("parado", 0.25);
  else if (op.vel < 2.8) op.tocar("andar", 0.25, op.vel / 1.45);
  else op.tocar("correr", 0.25, op.vel / 3.9);
}

function fimCarrinho(pulo: boolean): void {
  aposCarrinho = pulo || carrinho?.prolongado ? 0 : IMPULSO_JANELA;
  carrinho = null;
  esperaCarrinho = CARRINHO_ESPERA;
  if (!pulo) op.vel = Math.min(op.vel, 3.5); // o resto da velocidade se perde andando
}

// ---------------- carona: quem está em cima de um veículo anda junto com ele ----------------
const poseAnterior: Record<Veiculo, { x: number; z: number; rumo: number; y: number }> = {
  maq: { x: carro.x, z: carro.z, rumo: carro.rumo, y: carro.y },
  cam: { x: carroCam.x, z: carroCam.z, rumo: carroCam.rumo, y: carroCam.y },
};

// posição (no corpo do veículo) de um ponto do mundo; o caminho de volta é noCorpo()
function paraCorpo(x: number, z: number, p: { x: number; z: number; rumo: number }): { lx: number; lz: number } {
  const s = Math.sin(p.rumo);
  const c = Math.cos(p.rumo);
  const dx = x - p.x;
  const dz = z - p.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

// chamado depois de os veículos se mexerem no quadro: leva o operário pela diferença de pose
function carregarPassageiro(): void {
  for (const v of ["maq", "cam"] as Veiculo[]) {
    const atual = poseDe(v);
    const ant = poseAnterior[v];
    if (montado === v && aPe && !escalada && Math.hypot(atual.x - ant.x, atual.z - ant.z) < 3) {
      const { lx, lz } = paraCorpo(op.x, op.z, ant);
      const p = noCorpo(v, lx, lz);
      op.x = p.x;
      op.z = p.z;
      op.rumo += atual.rumo - ant.rumo;
      op.y += atual.y - ant.y;
      op.grupo.position.set(op.x, op.y, op.z);
      op.grupo.rotation.y = op.rumo;
    }
    ant.x = atual.x;
    ant.z = atual.z;
    ant.rumo = atual.rumo;
    ant.y = atual.y;
  }
}

// ---------------- toque (celular e tablet) ----------------
const mancheEsq = new Manche($("manche-esq"));
const mancheDir = new Manche($("manche-dir"));
const freioToque = botaoSegurar($("bt-freio"));
function rotularToque(): void {
  document.body.classList.toggle("modo-escavar", modo === "escavar");
  $("bt-modo").textContent = modo === "dirigir" ? "⛏️ Escavar" : "🚗 Dirigir";
  if (aPe) {
    mancheEsq.rotular("frente", "trás", "◀", "▶");
  } else if (veiculo === "cam" || modo === "dirigir") {
    if (veiculo === "cam") {
      mancheEsq.rotular("acelerar", "ré", "◀", "▶");
      mancheDir.rotular("caçamba sobe", "caçamba desce", "", "");
      return;
    }
    mancheEsq.rotular("acelerar", "ré", "◀", "▶");
    mancheDir.rotular("pá sobe", "pá desce", "recolhe", "despeja");
  } else {
    mancheEsq.rotular("estica braço", "recolhe braço", "gira", "gira");
    mancheDir.rotular("sobe lança", "desce lança", "fecha", "abre");
  }
}
atualizarTextos();
lembrarPainel("ajuda", "recolhida", true);
lembrarPainel("painel-missao", "recolhido", false);
$("bt-missao").addEventListener("click", () => alternarPainel("painel-missao", "recolhido"));
$("bt-modo").addEventListener("click", () => trocarModo());
$("bt-entrar").addEventListener("click", () => entrarOuSair());
const correrToque = botaoSegurar($("bt-correr"));
$("bt-pular").addEventListener("pointerdown", (e) => {
  e.preventDefault();
  pedirPulo = true;
});
const agacharToque = botaoSegurar($("bt-agachar"));
$("bt-camera").addEventListener("click", () => (cameraCabine = !cameraCabine));
// escolha do personagem: botões com data-pers no menu inicial e nos ajustes; vale na hora e vai para os outros jogadores
function escolherPersonagem(id: string): void {
  meuPersonagem = personagemValido(id);
  try {
    localStorage.setItem("retro-personagem", meuPersonagem);
  } catch {
    /* ignora */
  }
  if (convidado) convidado.av = meuPersonagem;
  void op.carregar(urlPersonagem(meuPersonagem));
  for (const b of document.querySelectorAll<HTMLElement>("[data-pers]")) b.classList.toggle("ativo", b.dataset.pers === meuPersonagem);
}
for (const b of document.querySelectorAll<HTMLElement>("[data-pers]")) b.addEventListener("click", () => escolherPersonagem(b.dataset.pers!));
for (const b of document.querySelectorAll<HTMLElement>("[data-pers]")) b.classList.toggle("ativo", b.dataset.pers === meuPersonagem);

// menu de ajustes (sensibilidade, câmera, controle e som)
function alternarAjustes(abrir?: boolean): void {
  const aberto = $("ajustes").classList.toggle("escondido", abrir === undefined ? undefined : !abrir) === false;
  if (aberto && document.pointerLockElement) document.exitPointerLock(); // solta o mouse para mexer nos controles
  if (!aberto) {
    teclas.clear();
    prenderMouse();
  }
}
ligarMenuAjustes($("ajustes"), () => {
  som.volume = ajustes.volume;
  voz.definirVolume(ajustes.volumeVoz);
});
som.volume = ajustes.volume;
for (const id of ["bt-ajustes", "bt-ajustes-pc", "bt-ajustes-inicio"]) $(id).addEventListener("click", () => alternarAjustes(true));
$("aj-fechar").addEventListener("click", () => alternarAjustes(false));
$("ajustes").addEventListener("pointerdown", (e) => {
  if (e.target === $("ajustes")) alternarAjustes(false); // toque fora da caixa fecha
});
$("bt-som").addEventListener("click", () => {
  som.ligado = !som.ligado;
  $("bt-som").textContent = som.ligado ? "🔊" : "🔇";
});
// tela cheia (no iPhone, explica como abrir pelo ícone da Tela de Início)
if (instalado()) document.body.classList.add("instalado");
const mostrarAjudaIos = () => $("ajuda-ios").classList.remove("escondido");
for (const id of ["bt-tela", "bt-tela-pc", "bt-tela-inicio"]) $(id).addEventListener("click", () => alternarTelaCheia(mostrarAjudaIos));
$("fechar-ajuda-ios").addEventListener("click", () => $("ajuda-ios").classList.add("escondido"));

// o que só funciona logo após um clique do jogador (som, tela cheia)
function gestoInicial(): void {
  som.iniciar();
  if (TOQUE && !instalado()) void entrarTelaCheia(); // no celular, entra em tela cheia e tenta travar na horizontal
}

function comecar(): void {
  if (jogando) return;
  jogando = true;
  document.body.classList.add("jogando");
  $("inicio").classList.add("escondido");
  prenderMouse();
  aviso(TOQUE ? "Ande até a porta da cabine e toque em 🚜 Entrar" : "Ande até a porta da cabine (lado esquerdo) e aperte E para entrar", 4.5);
}

$("jogar").addEventListener("click", () => {
  gestoInicial();
  comecar();
});

// ---------------- física da máquina ----------------
const RODAS: [number, number][] = [[1.05, -0.9], [-1.05, -0.9], [0.92, 1.75], [-0.92, 1.75]]; // [x, z] no corpo
const tmp = new THREE.Vector3();
const GUME_RETRO = [-0.2, 0.2];
const GUME_FRENTE = [-0.9, 0, 0.9];
const tmp2 = new THREE.Vector3();

function alturaRoda(x: number, z: number): number {
  const s = Math.sin(carro.rumo);
  const c = Math.cos(carro.rumo);
  return terreno.altura(carro.x + x * c + z * s, carro.z - x * s + z * c);
}

function dirigir(dt: number, acel: number, virar: number, freio: number): void {
  const parada = modo === "escavar" || maq.sapatas > 0.02;
  if (parada) {
    acel = 0;
    freio = 1;
  }
  const v = carro.vel;
  if (acel > 0) carro.vel += (v < 0 ? 7 : 2.6) * acel * dt;
  else if (acel < 0) carro.vel += (v > 0 ? 7 : 2.2) * acel * dt;
  else carro.vel -= Math.sign(v) * Math.min(Math.abs(v), 2.5 * dt);
  if (freio) carro.vel -= Math.sign(carro.vel) * Math.min(Math.abs(carro.vel), 9 * dt * freio);
  carro.vel = THREE.MathUtils.clamp(carro.vel, -3.5, 7);
  // a ladeira puxa
  carro.vel -= 9.8 * Math.sin(carro.arfagem) * dt * 0.35 * (parada ? 0 : 1);
  carro.vel = THREE.MathUtils.clamp(carro.vel, -3.5, 7);

  const alvoEsterco = virar * 0.6;
  carro.esterco += (alvoEsterco - carro.esterco) * Math.min(1, dt * 4);
  const antes = { x: carro.x, z: carro.z, rumo: carro.rumo };
  carro.rumo += (carro.vel * Math.tan(carro.esterco) / maq.entreEixos) * dt;
  carro.x += Math.sin(carro.rumo) * carro.vel * dt;
  carro.z += Math.cos(carro.rumo) * carro.vel * dt;
  [carro.x, carro.z] = limitar(carro.x, carro.z, 3);
  const batida = maquinaBate();
  if (batida && !maquinaBateEm(antes)) {
    Object.assign(carro, antes);
    if (Math.abs(carro.vel) > 1.5) aviso(batida === "caminhão" ? "💥 Cuidado com o caminhão!" : "💥 Bateu na árvore!");
    carro.vel = 0;
  }

  // assenta a máquina no terreno pelas 4 rodas
  const h = RODAS.map(([x, z]) => alturaRoda(x, z));
  const hTras = (h[0] + h[1]) / 2;
  const hFrente = (h[2] + h[3]) / 2;
  const hEsq = (h[0] + h[2]) / 2;
  const hDir = (h[1] + h[3]) / 2;
  const f = 1 - Math.exp(-dt * 12);
  const yAlvo = hTras + (hFrente - hTras) * (0.9 / maq.entreEixos) + maq.sapatas * 0.15;
  carro.y += (yAlvo - carro.y) * f;
  const arf = Math.atan2(hFrente - hTras, maq.entreEixos) * (1 - maq.sapatas * 0.8);
  const rol = Math.atan2(hEsq - hDir, 2.0) * (1 - maq.sapatas * 0.8);
  carro.arfagem += (arf - carro.arfagem) * f;
  carro.rolagem += (rol - carro.rolagem) * f;

  posicionarMaquina(dt);
}

// leva a pose do `carro` para o modelo (o convidado também usa, com a pose que vem do anfitrião)
function posicionarMaquina(dt: number): void {
  maq.raiz.position.set(carro.x, carro.y, carro.z);
  maq.raiz.rotation.y = carro.rumo;
  maq.corpo.rotation.set(-carro.arfagem, 0, carro.rolagem);
  for (const r of maq.rodas) {
    r.obj.rotation.x += (carro.vel * dt) / r.raio;
    if (r.dianteira) r.pivo.rotation.y = carro.esterco;
  }
}

// ---------------- física do caminhão ----------------
const RODAS_CAM: [number, number][] = [[1.0, -1.9], [-1.0, -1.9], [1.0, 1.7], [-1.0, 1.7]]; // [x, z] no corpo: traseiras e dianteiras
const EIXO_TRAS_CAM = 1.9; // do centro do corpo ao truque traseiro

function alturaRodaCam(x: number, z: number): number {
  const s = Math.sin(carroCam.rumo);
  const c = Math.cos(carroCam.rumo);
  return terreno.altura(carroCam.x + x * c + z * s, carroCam.z - x * s + z * c);
}

// leva a pose de `carroCam` para o modelo (o convidado também usa, com a pose que vem do anfitrião)
function posicionarCaminhao(dt: number): void {
  caminhao.grupo.position.set(carroCam.x, carroCam.y, carroCam.z);
  caminhao.grupo.rotation.y = carroCam.rumo;
  caminhao.corpo.rotation.set(-carroCam.arfagem, 0, carroCam.rolagem);
  caminhao.aplicarInclinacao();
  for (const r of caminhao.rodas) {
    r.obj.rotation.x += (carroCam.vel * dt) / r.raio;
    if (r.dianteira) r.pivo.rotation.y = carroCam.esterco;
  }
  caminhao.grupo.updateMatrixWorld(true);
}

// o caminhão encosta na retroescavadeira ou numa árvore?
function caminhaoBate(): "máquina" | "árvore" | null {
  caminhao.grupo.position.set(carroCam.x, carroCam.y, carroCam.z);
  caminhao.grupo.rotation.y = carroCam.rumo;
  caminhao.grupo.updateMatrixWorld(true);
  const meus = caminhao.blocos();
  if (Math.hypot(carro.x - carroCam.x, carro.z - carroCam.z) < 14) {
    for (const b of blocosMaquina()) {
      for (const a of meus) {
        if (a.y0 >= b.y1 || a.y1 <= b.y0) continue;
        if (b.circulo ? caixaECirculo(a, b) : caixasSeCruzam(a, b)) return "máquina";
      }
    }
  }
  for (const t of arvores) {
    if (Math.hypot(t.x - carroCam.x, t.z - carroCam.z) > 8) continue;
    for (const a of meus) if (caixaECirculo(a, t)) return "árvore";
  }
  if (carroCam.x < -14 && carroCam.z > 14) {
    for (const casa of favela.pegadas) {
      if (Math.hypot(casa.x - carroCam.x, casa.z - carroCam.z) > 10) continue;
      for (const a of meus) if (caixasSeCruzam(a, casa)) return "árvore";
    }
  }
  return null;
}

function caminhaoBateEm(pose: { x: number; z: number; rumo: number }): boolean {
  const atual = { x: carroCam.x, z: carroCam.z, rumo: carroCam.rumo };
  Object.assign(carroCam, pose);
  const bate = caminhaoBate() !== null;
  Object.assign(carroCam, atual);
  return bate;
}

// a terra escorre pela traseira quando a caçamba passa de ~20°: vira torrões que caem no chão e formam um monte
function despejarCaminhao(dt: number): void {
  const inc = caminhao.inclinacao;
  if (inc < 0.35 || caminhao.volume <= 0.001) return;
  const q = Math.min(caminhao.volume, (0.8 + 4 * (inc - 0.35)) * dt); // m³ por segundo: quanto mais alta, mais rápido
  caminhao.definirVolume(caminhao.volume - q);
  const n = Math.max(1, Math.round(q / 0.012));
  const beira = caminhao.beiraTraseira(new THREE.Vector3());
  const atras = new THREE.Vector3(-Math.sin(carroCam.rumo), 0, -Math.cos(carroCam.rumo));
  const lado = new THREE.Vector3(Math.cos(carroCam.rumo), 0, -Math.sin(carroCam.rumo));
  for (let i = 0; i < n; i++) {
    const p = beira.clone().addScaledVector(lado, (Math.random() - 0.5) * 2.0);
    const v = atras.clone().multiplyScalar(0.8 + Math.random() * 0.8).addScaledVector(lado, (Math.random() - 0.5) * 0.6);
    v.y = -0.2 - Math.random() * 0.4;
    particulas.emitir(p, v, q / n, 0.2);
  }
  somTerra = Math.max(somTerra, q * 12);
}

function dirigirCaminhao(dt: number, acel: number, virar: number, freio: number, bascula: number): void {
  const c = carroCam;
  const sem = condutorCam === ""; // sem motorista: freio de mão
  if (sem) {
    acel = 0;
    freio = 1;
    bascula = 0;
  }
  // caçamba levantada: anda devagar; e só levanta com o caminhão (quase) parado
  const alto = caminhao.inclinacao > 0.15;
  if (bascula > 0 && Math.abs(c.vel) > 2.5) bascula = 0;
  if (bascula !== 0) caminhao.inclinacao = THREE.MathUtils.clamp(caminhao.inclinacao + bascula * 0.4 * dt, 0, Caminhao.INCLINACAO_MAX);
  const v = c.vel;
  if (acel > 0) c.vel += (v < 0 ? 6 : 2.2) * acel * dt;
  else if (acel < 0) c.vel += (v > 0 ? 6 : 1.8) * acel * dt;
  else c.vel -= Math.sign(v) * Math.min(Math.abs(v), 1.6 * dt);
  if (freio) c.vel -= Math.sign(c.vel) * Math.min(Math.abs(c.vel), 8 * dt * freio);
  const vmax = alto ? 2 : 10;
  c.vel = THREE.MathUtils.clamp(c.vel, -Math.min(4, vmax), vmax);
  c.vel -= 9.8 * Math.sin(c.arfagem) * dt * 0.3 * (sem ? 0 : 1); // a ladeira puxa
  c.vel = THREE.MathUtils.clamp(c.vel, -Math.min(4, vmax), vmax);

  c.esterco += (virar * 0.5 - c.esterco) * Math.min(1, dt * 3.5);
  const antes = { x: c.x, z: c.z, rumo: c.rumo };
  c.rumo += ((c.vel * Math.tan(c.esterco)) / caminhao.entreEixos) * dt;
  c.x += Math.sin(c.rumo) * c.vel * dt;
  c.z += Math.cos(c.rumo) * c.vel * dt;
  [c.x, c.z] = limitar(c.x, c.z, 3);
  if (Math.abs(c.vel) > 0.01 || Math.abs(c.esterco) > 0.01) {
    const batida = caminhaoBate();
    if (batida && !caminhaoBateEm(antes)) {
      Object.assign(c, antes);
      if (Math.abs(c.vel) > 2 && condutorCam === meuUid) aviso(batida === "máquina" ? "💥 Cuidado com a retroescavadeira!" : "💥 Bateu na árvore!");
      c.vel = 0;
    }
  }

  // assenta no terreno pelas 4 rodas
  const h = RODAS_CAM.map(([x, z]) => alturaRodaCam(x, z));
  const hTras = (h[0] + h[1]) / 2;
  const hFrente = (h[2] + h[3]) / 2;
  const hEsq = (h[0] + h[2]) / 2;
  const hDir = (h[1] + h[3]) / 2;
  const f = 1 - Math.exp(-dt * 12);
  const yAlvo = hTras + (hFrente - hTras) * (EIXO_TRAS_CAM / caminhao.entreEixos);
  c.y += (yAlvo - c.y) * f;
  c.arfagem += (Math.atan2(hFrente - hTras, caminhao.entreEixos) - c.arfagem) * f;
  c.rolagem += (Math.atan2(hEsq - hDir, 2.0) - c.rolagem) * f;
  posicionarCaminhao(dt);
  despejarCaminhao(dt);
}

function maquinaBateEm(pose: { x: number; z: number; rumo: number }): boolean {
  const atual = { x: carro.x, z: carro.z, rumo: carro.rumo };
  Object.assign(carro, pose);
  const bate = maquinaBate() !== null;
  Object.assign(carro, atual);
  return bate;
}

// a máquina (corpo e pá da frente) encosta no caminhão ou numa árvore? (a pá erguida passa por cima do caminhão)
function maquinaBate(): "caminhão" | "árvore" | null {
  maq.raiz.position.set(carro.x, carro.y, carro.z);
  maq.raiz.rotation.y = carro.rumo;
  maq.raiz.updateMatrixWorld(true);
  const corpo = (() => {
    const p = corpoParaMundo(0, -0.2);
    return caixa(p.x, p.z, carro.rumo, 1.35, 2.55, carro.y, carro.y + 3.3);
  })();
  const c = maq.conchaFrenteG.localToWorld(new THREE.Vector3(0, -0.05, 0.45));
  const pa = caixa(c.x, c.z, carro.rumo, 1.18, 0.5, c.y - 0.42, c.y + 0.45);
  for (const b of caminhao.blocos()) {
    if (caixasSeCruzam(corpo, b)) return "caminhão";
    if (pa.y0 < b.y1 && pa.y1 > b.y0 && caixasSeCruzam(pa, b)) return "caminhão";
  }
  for (const a of arvores) {
    if (Math.hypot(a.x - carro.x, a.z - carro.z) > 8) continue;
    if (caixaECirculo(corpo, a) || caixaECirculo(pa, a)) return "árvore";
  }
  if (carro.x < -14 && carro.z > 14) {
    for (const casa of favela.pegadas) {
      if (Math.hypot(casa.x - carro.x, casa.z - carro.z) > 9) continue;
      if (caixasSeCruzam(corpo, casa) || caixasSeCruzam(pa, casa)) return "árvore";
    }
  }
  return null;
}

// alguma concha (ou o braço) entrou no caminhão? (a caçamba aberta deixa entrar por cima, até a terra)
function conchaNoCaminhao(): boolean {
  const pts: THREE.Vector3[] = [
    maq.retro.ponta.getWorldPosition(new THREE.Vector3()),
    maq.retro.boca.getWorldPosition(new THREE.Vector3()),
    maq.conchaG.getWorldPosition(new THREE.Vector3()),
    maq.conchaG.localToWorld(new THREE.Vector3(0, 0.45, -0.4)),
    maq.frente.boca.getWorldPosition(new THREE.Vector3()),
    ...pontosGume(maq.frente, GUME_FRENTE),
  ];
  const blocos = caminhao.blocos();
  return pts.some((p) => blocos.some((b) => dentro(b, p.x, p.y, p.z)));
}

// move uma articulação com aceleração suave; devolve o quanto ela se mexeu
function moverJunta(nome: keyof typeof LIMITES, entrada: number, dt: number): number {
  const alvo = entrada * VEL_JUNTA[nome];
  taxa[nome] += (alvo - taxa[nome]) * Math.min(1, dt * 7);
  const [min, max] = LIMITES[nome];
  const antes = maq[nome];
  maq[nome] = THREE.MathUtils.clamp(antes + taxa[nome] * dt, min, max);
  if (maq[nome] === min || maq[nome] === max) taxa[nome] = 0;
  return Math.abs(maq[nome] - antes) / dt;
}

// pontos do gume da concha (no mundo), espalhados na largura
function pontosGume(conc: Concha, larguraPontos: number[]): THREE.Vector3[] {
  const ponta = conc.ponta.getWorldPosition(new THREE.Vector3());
  const lateral = new THREE.Vector3(1, 0, 0).applyQuaternion(conc.pivo.getWorldQuaternion(new THREE.Quaternion()));
  return larguraPontos.map((d) => ponta.clone().addScaledVector(lateral, d));
}

// quanto o gume está enterrado (m)
function enterrado(conc: Concha, larguraPontos: number[]): number {
  let fundo = 0;
  for (const p of pontosGume(conc, larguraPontos)) fundo = Math.max(fundo, terreno.altura(p.x, p.z) - p.y);
  return fundo;
}

// A concha corta a terra quando o gume entra no chão. Cheia (ou no fundo máximo), ela não afunda mais:
// trava só o movimento que enterraria mais (levantar continua livre).
function cortar(conc: Concha, raio: number, larguraPontos: number[], antes: number): { travou: boolean; cortou: number } {
  let cortou = 0;
  for (const p of pontosGume(conc, larguraPontos)) {
    if (p.y >= terreno.altura(p.x, p.z) - 0.02) continue;
    const livre = conc.capacidade - conc.carga;
    const v = terreno.cavar(p.x, p.z, p.y, raio, livre / larguraPontos.length);
    conc.carga += v;
    cortou += v;
  }
  const depois = enterrado(conc, larguraPontos);
  return { travou: depois > 0.18 && depois > antes + 0.003, cortou };
}

// concha virada para baixo: a terra escorre e cai
function despejar(conc: Concha, dt: number, tamanho: number): number {
  if (conc.carga <= 0) return 0;
  const ab = maq.aberturaMundo(conc, tmp2);
  if (ab.y > -0.3) return 0; // só derrama com a concha bem virada para baixo
  const boca = conc.boca.getWorldPosition(tmp);
  if (boca.y < terreno.altura(boca.x, boca.z) + 0.05) return 0; // enterrada: a terra não tem para onde cair
  const q = Math.min(conc.carga, conc.capacidade * 1.6 * -ab.y * dt);
  conc.carga -= q;
  if (conc.carga < 0.002) conc.carga = 0;
  const nTorroes = Math.max(1, Math.round(q / (tamanho ** 3 * 1.1)));
  for (let n = 0; n < nTorroes; n++) {
    const p = boca.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.5));
    const vel = ab.clone().multiplyScalar(0.8).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6));
    particulas.emitir(p, vel, q / nTorroes, tamanho);
  }
  return q;
}

function salvarJuntas() {
  return { giro: maq.giro, lanca: maq.lanca, braco: maq.braco, concha: maq.concha, bracoFrente: maq.bracoFrente, conchaFrente: maq.conchaFrente };
}

function atualizarMaquina(dt: number): void {
  if (papel === "convidado") aplicarEstadoRede(dt); // a máquina é do anfitrião: aqui só se copia a pose dela
  const gp = controle();
  let acel = 0, virar = 0, freio = 0;
  let giro = 0, lanca = 0, braco = 0, concha = 0, bracoF = 0, conchaF = 0, bascula = 0;
  if (jogando && aPe) {
    let frente = k("KeyW") + k("ArrowUp") - k("KeyS") - k("ArrowDown");
    let lado = k("KeyD") + k("ArrowRight") - k("KeyA") - k("ArrowLeft");
    let correr = teclas.has("ShiftLeft") || teclas.has("ShiftRight");
    let agachar = agachandoTeclado();
    if (TOQUE) {
      frente -= mancheEsq.y;
      lado += mancheEsq.x;
      if (correrToque.apertado) correr = true;
      if (agacharToque.apertado) agachar = true;
    }
    if (gp) {
      const [lx, ly] = gp.axes.map(zona);
      frente -= ly;
      lado += lx;
      if ((gp.buttons[7]?.value ?? 0) > 0.5 || gp.buttons[10]?.pressed) correr = true; // RT ou apertar o manche
      const a = !!gp.buttons[0]?.pressed;
      if (a && !botaoAAntes) pedirPulo = true;
      botaoAAntes = a;
      if (gp.buttons[1]?.pressed) agachar = true; // B: agacha enquanto segura
    }
    andarAPe(dt, THREE.MathUtils.clamp(frente, -1, 1), THREE.MathUtils.clamp(lado, -1, 1), correr, agachar, pedirPulo);
    pedirPulo = false;
  } else if (!aPe) {
    op.grupo.visible = !cameraCabine;
  }
  if (condutor !== "" && papel !== "convidado") {
    // quem estiver sentado (eu ou outro jogador) vira o banco para trás quando escava
    const alvoBanco = modo === "escavar" ? Math.PI : 0;
    maq.banco.rotation.y += (alvoBanco - maq.banco.rotation.y) * Math.min(1, dt * 4);
  }
  if (gp) {
    const x = !!gp.buttons[2]?.pressed; // X: entrar / sair
    if (x && !botaoXAntes) entrarOuSair();
    botaoXAntes = x;
  }
  const emCam = !aPe && veiculo === "cam";
  if (jogando && !aPe) {
    if (modo === "dirigir" || emCam) {
      acel = k("KeyW") + k("ArrowUp") - k("KeyS") - k("ArrowDown");
      virar = k("KeyA") + k("ArrowLeft") - k("KeyD") - k("ArrowRight");
      freio = k("Space");
      bracoF = k("KeyF") - k("KeyR");
      conchaF = k("KeyG") - k("KeyT");
    } else {
      lanca = k("KeyW") - k("KeyS");
      giro = k("KeyA") - k("KeyD");
      braco = k("KeyI") + k("ArrowUp") - k("KeyK") - k("ArrowDown");
      concha = k("KeyL") + k("ArrowRight") - k("KeyJ") - k("ArrowLeft");
    }
    if (TOQUE) {
      if (modo === "dirigir" || emCam) {
        acel -= mancheEsq.y;
        virar -= mancheEsq.x;
        freio = Math.max(freio, freioToque.apertado ? 1 : 0);
        bracoF += mancheDir.y;
        conchaF += mancheDir.x;
      } else {
        giro -= mancheEsq.x;
        braco -= mancheEsq.y;
        lanca -= mancheDir.y;
        concha += mancheDir.x;
      }
    }
    if (gp) {
      const [lx, ly, rx, ry] = gp.axes.map(zona);
      if (modo === "dirigir" || emCam) {
        acel += (gp.buttons[7]?.value ?? 0) - (gp.buttons[6]?.value ?? 0);
        virar -= lx;
        freio = Math.max(freio, gp.buttons[1]?.pressed ? 1 : 0);
        bracoF += ry;
        conchaF += rx;
      } else {
        // padrão ISO: esquerdo gira e estica o braço; direito sobe a lança e mexe a concha
        giro -= lx;
        braco -= ly;
        lanca -= ry;
        concha += rx;
      }
      const y = !!gp.buttons[3]?.pressed;
      if (y && !botaoYAntes) trocarModo();
      botaoYAntes = y;
    }
    if (emCam) {
      // no caminhão: R / F (ou o manche direito, para cima / para baixo) levantam e abaixam a caçamba
      bascula = -bracoF;
      bracoF = 0;
      conchaF = 0;
    }
  }

  if (papel === "convidado") {
    if (!aPe) enviarControle(dt, { acel, virar, freio, giro, lanca, braco, concha, bracoF, conchaF, bascula });
    const vel = emCam ? carroCam.vel : carro.vel;
    som.atualizar(Math.min(1, Math.abs(vel) / 7 + Math.abs(acel) * 0.25 + Math.min(hidrRede, 1.5) * 0.35), Math.min(1, hidrRede * 0.8), 0);
    return;
  }
  // cada veículo obedece a quem está sentado nele: eu (o que estou apertando) ou outro jogador (o que ele manda; sem notícia
  // há meio segundo, solta tudo)
  const local: Entrada = { acel, virar, freio, giro, lanca, braco, concha, bracoF, conchaF, bascula };
  const doJogador = (uid: string): Entrada => {
    if (uid === "") return ENTRADA_ZERO;
    if (uid === meuUid) return local;
    const r = entradasRemotas.get(uid);
    return r && performance.now() - r.t < 500 ? r.e : ENTRADA_ZERO;
  };
  const entCam = doJogador(condutorCam);
  dirigirCaminhao(dt, THREE.MathUtils.clamp(entCam.acel, -1, 1), THREE.MathUtils.clamp(entCam.virar, -1, 1), entCam.freio, THREE.MathUtils.clamp(entCam.bascula, -1, 1));
  ({ acel, virar, freio, giro, lanca, braco, concha, bracoF, conchaF } = doJogador(condutor));

  dirigir(dt, THREE.MathUtils.clamp(acel, -1, 1), THREE.MathUtils.clamp(virar, -1, 1), freio);
  const alvoSapatas = modo === "escavar" ? 1 : 0;
  maq.sapatas += THREE.MathUtils.clamp(alvoSapatas - maq.sapatas, -dt * 1.2, dt * 1.2);

  // articulações: se a concha entra fundo demais no chão (cheia ou no limite), o movimento volta
  const antes = salvarJuntas();
  const conchaJaDentro = conchaNoCaminhao();
  const fundoRetro = enterrado(maq.retro, GUME_RETRO);
  const fundoFrente = enterrado(maq.frente, GUME_FRENTE);
  let hidr = 0;
  hidr += moverJunta("giro", THREE.MathUtils.clamp(giro, -1, 1), dt);
  hidr += moverJunta("lanca", THREE.MathUtils.clamp(lanca, -1, 1), dt);
  hidr += moverJunta("braco", THREE.MathUtils.clamp(braco, -1, 1), dt);
  hidr += moverJunta("concha", THREE.MathUtils.clamp(concha, -1, 1), dt);
  hidr += moverJunta("bracoFrente", THREE.MathUtils.clamp(bracoF, -1, 1), dt);
  hidr += moverJunta("conchaFrente", THREE.MathUtils.clamp(conchaF, -1, 1), dt);
  maq.atualizarPose();

  const r = cortar(maq.retro, 0.55, GUME_RETRO, fundoRetro);
  const f = cortar(maq.frente, 0.6, GUME_FRENTE, fundoFrente);
  if (!conchaJaDentro && conchaNoCaminhao()) {
    // bateu no caminhão: o movimento volta
    Object.assign(maq, antes);
    for (const n in taxa) taxa[n] = 0;
    maq.atualizarPose();
    if (avisoTempo <= 0) aviso("A concha bateu no caminhão", 1.2);
  } else if (r.travou || f.travou) {
    Object.assign(maq, antes);
    for (const n in taxa) taxa[n] = 0;
    if (f.travou && carro.vel > 0) carro.vel = 0;
    maq.atualizarPose();
    const cheia = (r.travou && maq.retro.carga >= maq.retro.capacidade * 0.98) || (f.travou && maq.frente.carga >= maq.frente.capacidade * 0.98);
    if (avisoTempo <= 0) aviso(cheia ? "Concha cheia! Levante e despeje" : "Chão duro: não dá para cavar mais fundo aqui", 1.5);
  }
  // torrões soltos quando corta
  for (const [res, conc] of [[r, maq.retro], [f, maq.frente]] as const) {
    if (res.cortou > 0.002 && Math.random() < 0.6) {
      const p = conc.ponta.getWorldPosition(new THREE.Vector3());
      particulas.emitir(p.add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3((Math.random() - 0.5) * 1.2, 1 + Math.random(), (Math.random() - 0.5) * 1.2), 0, 0.09);
    }
  }
  const caiu = despejar(maq.retro, dt, 0.16) + despejar(maq.frente, dt, 0.22);
  const boca = maq.retro.boca.getWorldPosition(new THREE.Vector3());
  const naCacamba = caminhao.superficie(boca.x, boca.z);
  const chao = naCacamba ?? terreno.altura(boca.x, boca.z);
  mira.visible = modo === "escavar" && maq.retro.carga > 0.01 && boca.y > chao + 0.4;
  mira.position.set(boca.x, chao + 0.06, boca.z);
  (mira.material as THREE.MeshBasicMaterial).color.set(naCacamba !== null ? "#4cc46a" : "#ffd34d");
  somTerra = Math.max(somTerra * Math.exp(-dt * 6), (r.cortou + f.cortou) * 40, caiu * 6);

  const giroMotor = emCam
    ? Math.min(1, Math.abs(carroCam.vel) / 9 + Math.abs(entCam.acel) * 0.25)
    : Math.min(1, Math.abs(carro.vel) / 7 + Math.abs(acel) * 0.25 + Math.min(hidr, 1.5) * 0.35);
  som.atualizar(giroMotor, Math.min(1, hidr * 0.8), somTerra);
}

// ---------------- câmera ----------------
const alvoCam = new THREE.Vector3();
const posCam = new THREE.Vector3();
const ponto = new THREE.Vector3();

// aproxima a câmera do operário até ela deixar de ficar dentro de uma parede ou laje (dentro das casas)
function recuarCamera(de: THREE.Vector3, ate: THREE.Vector3): void {
  const blocos = favela.perto(de.x, de.z);
  if (blocos.length === 0) return;
  const passos = 16;
  for (let i = 1; i <= passos; i++) {
    ponto.lerpVectors(de, ate, i / passos);
    for (const b of blocos) {
      if (ponto.y < b.y0 - 0.3 || ponto.y > b.y1 + 0.3) continue;
      if (b.circulo ? Math.hypot(ponto.x - b.x, ponto.z - b.z) < b.hx + 0.3 : contem({ ...b, hx: b.hx + 0.3, hz: b.hz + 0.3 }, ponto.x, ponto.z)) {
        ate.lerpVectors(de, ate, Math.max(0.12, (i - 1.5) / passos)); // para um pouco antes do obstáculo
        return;
      }
    }
  }
}
const PITCH_CHAO = 0.08; // a câmera orbital não desce abaixo disso: o resto do giro vira olhar para cima
function atualizarCamera(dt: number): void {
  const emCam = !aPe && veiculo === "cam";
  if (cameraCabine) {
    const escavando = !emCam && modo === "escavar";
    const assento = (emCam ? caminhao.assentoPos : maq.assentoPos).getWorldPosition(new THREE.Vector3());
    const olhar = emCam ? carroCam.rumo : modo === "dirigir" ? carro.rumo : carro.rumo + Math.PI - maq.giro * 0.6;
    const yaw = olhar + orbita.yaw - (escavando ? Math.PI : 0);
    camera.position.copy(assento).add(new THREE.Vector3(0, emCam ? 0 : 0.15, 0));
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(orbita.pitch - 0.35), -Math.sin(orbita.pitch - 0.35) - (escavando ? 0.25 : 0.05), Math.cos(yaw) * Math.cos(orbita.pitch - 0.35));
    camera.lookAt(camera.position.clone().add(dir));
    camera.fov = 70;
    camera.updateProjectionMatrix();
    return;
  }
  if (camera.fov !== 55) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
  const centro = aPe ? new THREE.Vector3(op.x, op.grupo.position.y + 1.45, op.z) : emCam ? new THREE.Vector3(carroCam.x, carroCam.y + 2.0, carroCam.z) : new THREE.Vector3(carro.x, carro.y + 1.6, carro.z);
  if (!aPe && !emCam && modo === "escavar") {
    // olha entre a máquina e a concha
    const concha = maq.retro.ponta.getWorldPosition(new THREE.Vector3());
    centro.lerp(concha, 0.55);
  }
  const f = 1 - Math.exp(-dt * 6);
  alvoCam.lerp(centro, alvoCam.lengthSq() === 0 ? 1 : f);
  const yaw = aPe ? orbita.yaw : (emCam ? carroCam.rumo : carro.rumo) + Math.PI + orbita.yaw; // a pé, a câmera não gira com o veículo
  // pitch abaixo de 0,08: a câmera para de descer, chega mais perto das costas e a mira sobe (olhar para cima)
  const pit = Math.max(orbita.pitch, PITCH_CHAO);
  const paraCima = Math.max(0, PITCH_CHAO - orbita.pitch) * 0.6; // rad acima da linha até o personagem
  const dist = orbita.dist * (1 - 0.45 * Math.min(1, paraCima / 0.5));
  posCam.set(
    alvoCam.x + Math.sin(yaw) * Math.cos(pit) * dist,
    alvoCam.y + Math.sin(pit) * dist,
    alvoCam.z + Math.cos(yaw) * Math.cos(pit) * dist,
  );
  posCam.y = Math.max(posCam.y, terreno.altura(posCam.x, posCam.z) + 0.8);
  if (aPe) recuarCamera(alvoCam, posCam);
  camera.position.lerp(posCam, camera.position.lengthSq() === 0 ? 1 : Math.min(1, f * 1.5));
  if (paraCima > 0) {
    const hx = alvoCam.x - camera.position.x;
    const hz = alvoCam.z - camera.position.z;
    const hd = Math.hypot(hx, hz) || 1;
    const a = Math.atan2(alvoCam.y - camera.position.y, hd) + paraCima;
    const d = Math.max(hd, 3);
    camera.lookAt(camera.position.x + (hx / hd) * Math.cos(a) * d, camera.position.y + Math.sin(a) * d, camera.position.z + (hz / hd) * Math.cos(a) * d);
  } else camera.lookAt(alvoCam);
  sol.position.set(alvoCam.x + 18, alvoCam.y + 30, alvoCam.z + 12);
  sol.target.position.copy(alvoCam);
}

// ---------------- missão e HUD ----------------
function atualizarHud(dt: number): void {
  tempoMissao -= dt;
  if (tempoMissao <= 0) {
    tempoMissao = 0.4;
    progresso = terreno.progressoVala(VALA.x0, VALA.x1, VALA.z0, VALA.z1, VALA.profundidade);
    if (!valaPronta && progresso >= 0.9) {
      valaPronta = true;
      aviso("🎉 Vala pronta! Agora encha o caminhão", 4);
    }
  }
  if (aPe) {
    const perto = veiculoPerto() !== null;
    document.body.classList.toggle("perto-porta", perto);
    const dicaEntrar = TOQUE ? "Toque em 🚜 Entrar" : "E para entrar";
    const dicaEscalar = TOQUE ? "⬆️ para escalar" : "Espaço para escalar";
    $("velocidade").textContent = perto && podeEscalar && !escalada ? `${dicaEntrar} · ${dicaEscalar}` : perto ? dicaEntrar : escalada ? "Escalando" : podeEscalar ? (TOQUE ? "⬆️ para escalar" : "Espaço para escalar") : !op.noChao ? "No ar" : op.agachado ? "Agachado" : op.vel > 2.8 ? "Correndo" : op.vel > 0.15 ? "Andando" : "Parado";
    $("bt-agachar").classList.toggle("ligado", op.agachado);
  } else if (veiculo === "cam") $("velocidade").textContent = `${Math.round(Math.abs(carroCam.vel) * 3.6)} km/h${carroCam.vel < -0.1 ? " (ré)" : ""}${caminhao.inclinacao > 0.02 ? ` · caçamba ${Math.round((caminhao.inclinacao * 180) / Math.PI)}°` : ""}`;
  else $("velocidade").textContent = modo === "dirigir" ? `${Math.round(Math.abs(carro.vel) * 3.6)} km/h${carro.vel < -0.1 ? " (ré)" : ""}` : maq.sapatas < 1 ? "Baixando sapatas..." : "Sapatas no chão";
  $("barra-vala").style.width = `${Math.round(progresso * 100)}%`;
  $("missao-vala").textContent = `Vala: ${Math.round(progresso * 100)}%`;
  $("missao-resumo").textContent = `· vala ${Math.round(progresso * 100)}%`;
  $("missao-caminhao").textContent = `Caminhão: ${caminhao.volume.toFixed(1).replace(".", ",")} m³`;
  const pr = maq.retro.carga / maq.retro.capacidade;
  const pf = maq.frente.carga / maq.frente.capacidade;
  $("carga-retro").textContent = `${Math.round(pr * 100)}%`;
  $("carga-frente").textContent = `${Math.round(pf * 100)}%`;
  $("barra-retro").style.width = `${Math.min(100, pr * 100)}%`;
  $("barra-frente").style.width = `${Math.min(100, pf * 100)}%`;
  if (avisoTempo > 0) {
    avisoTempo -= dt;
    if (avisoTempo <= 0) $("aviso").classList.add("escondido");
  }
}

// ---------------- sala (jogar com amigos) ----------------
// O anfitrião roda a obra inteira (máquina, terreno, caminhão) e manda o estado ~15 vezes por segundo. Cada convidado
// anda e opera pela rede: manda onde está e, se estiver na cabine, o que está apertando. A identidade (uid) fica no
// navegador, então quem cai volta com a mesma palavra e reencontra a obra, a posição e até o lugar na cabine.
interface Entrada { acel: number; virar: number; freio: number; giro: number; lanca: number; braco: number; concha: number; bracoF: number; conchaF: number; bascula: number }
const ENTRADA_ZERO: Entrada = { acel: 0, virar: 0, freio: 0, giro: 0, lanca: 0, braco: 0, concha: 0, bracoF: 0, conchaF: 0, bascula: 0 };
const entradasRemotas = new Map<string, { e: Entrada; t: number }>(); // o que cada convidado está apertando
let anfitriao: Anfitriao | null = null;
let convidado: Convidado | null = null;

interface Registro extends DadosJogador {
  uid: string;
  nome: string;
  ligado: boolean;
  ausente: number;
  nela?: { v: Veiculo; lx: number; lz: number; ly: number; lr: number }; // em cima de um veículo: posição no corpo dele
}
const registros = new Map<string, Registro>(); // anfitrião: todo convidado que passou (os que caíram ficam esperando)
let pendentesPt: number[][] = [];
let tRede = 0;
let tPainel = 0;
let tSalvar = 0;
let obraSuja = false;
let volumeSalvo = 0;
// convidado
let alvoRede: Msg | null = null;
let primeiroEstado = true;
let jaEntrou = false;
let hidrRede = 0;
let tControle = 0;

const num = (v: unknown, limite = 1e6): number => (typeof v === "number" && isFinite(v) ? THREE.MathUtils.clamp(v, -limite, limite) : 0);
const dadosDoOperario = (): DadosJogador => ({ x: op.x, y: op.y, z: op.z, rumo: op.rumo, anim: op.atual, esc: op.escala, av: meuPersonagem });

function tickRede(dt: number): void {
  if (papel === "solo") return;
  tPainel -= dt;
  if (tPainel <= 0) {
    tPainel = 0.5;
    atualizarPainelSala();
  }
  tRede -= dt;
  if (tRede > 0) return;
  tRede = 1 / 15;
  if (papel === "anfitriao") {
    tickAnfitriao();
    return;
  }
  if (aPe && convidado?.conectado) {
    // em cima da máquina, manda também onde está no corpo dela: assim o anfitrião o põe no lugar certo mesmo com atraso
    const nela = montado ? { mt: 1, v: montado, ...paraCorpo(op.x, op.z, poseDe(montado)), ly: op.y - poseDe(montado).y, lr: op.rumo - poseDe(montado).rumo } : {};
    convidado.enviar({ t: "p", ...dadosDoOperario(), ...nela });
  }
  // o convidado também guarda uma cópia da obra: se a sala ficar sem dono, quem a reabrir continua de onde parou
  tSalvar -= 1 / 15;
  if (tSalvar <= 0) {
    tSalvar = 10;
    if (convidado && alvoRede) salvarObra(convidado.palavra);
  }
}

// ----- anfitrião -----
function tickAnfitriao(): void {
  const agora = Date.now();
  for (const r of [...registros.values()]) {
    if (r.ligado) continue;
    const sentado = condutor === r.uid || condutorCam === r.uid;
    if (sentado && agora - r.ausente > 20000) liberarCabine(r); // sumiu com a cabine: o veículo não fica preso
    else if (!sentado && agora - r.ausente > 180000) {
      registros.delete(r.uid);
      elenco.remover(r.uid);
    }
  }
  const alteracao = terreno.tomarAlteracao();
  if (alteracao || caminhao.volume !== volumeSalvo) obraSuja = true;
  if (anfitriao && anfitriao.ligados.size > 0) {
    const e = dadosDoOperario();
    const jog: unknown[][] = [[UID_ANFITRIAO, meuNome, e.x, e.y, e.z, e.rumo, e.anim, e.esc, meuPersonagem]];
    for (const r of registros.values()) jog.push([r.uid, r.nome, r.x, r.y, r.z, r.rumo, r.anim, r.esc, r.av]);
    const msg: Msg = {
      t: "s",
      c: [carro.x, carro.y, carro.z, carro.rumo, carro.vel, carro.esterco, carro.arfagem, carro.rolagem],
      j: [maq.giro, maq.lanca, maq.braco, maq.concha, maq.bracoFrente, maq.conchaFrente, maq.sapatas],
      b: maq.banco.rotation.y,
      m: modo === "escavar" ? 1 : 0,
      k: condutor,
      kc: condutorCam,
      bc: caminhao.inclinacao,
      tc: [carroCam.x, carroCam.y, carroCam.z, carroCam.rumo, carroCam.vel, carroCam.esterco, carroCam.arfagem, carroCam.rolagem],
      cr: maq.retro.carga,
      cf: maq.frente.carga,
      v: caminhao.volume,
      jog,
      pt: pendentesPt,
    };
    if (alteracao) msg.ter = { i0: alteracao.i0, i1: alteracao.i1, j0: alteracao.j0, j1: alteracao.j1, mm: mmParaBuffer(alteracao.mm) };
    anfitriao.transmitir(msg);
  }
  pendentesPt = [];
  tSalvar -= 1 / 15;
  if (tSalvar <= 0) {
    tSalvar = 5;
    if (obraSuja && anfitriao) salvarObra(anfitriao.palavra);
  }
}

function posicionarNela(r: Registro): void {
  if (!r.nela) return;
  const pose = poseDe(r.nela.v);
  const p = noCorpo(r.nela.v, r.nela.lx, r.nela.lz);
  r.x = p.x;
  r.z = p.z;
  r.y = pose.y + r.nela.ly;
  r.rumo = pose.rumo + r.nela.lr;
}

// convidados em cima da máquina seguem a pose dela a cada quadro
function acompanharPassageiros(): void {
  for (const r of registros.values()) {
    if (!r.nela || condutor === r.uid || condutorCam === r.uid) continue;
    posicionarNela(r);
    elenco.atualizar(r.uid, r.nome, r);
  }
}

function liberarCabine(r: Registro): void {
  r.nela = undefined;
  const v: Veiculo = condutorCam === r.uid ? "cam" : "maq";
  definirCondutorDe(v, "");
  entradasRemotas.delete(r.uid);
  const porta = portaDe(v);
  const p = noCorpo(v, porta.x + 0.6, porta.z);
  r.x = p.x;
  r.z = p.z;
  r.y = terreno.altura(p.x, p.z);
  r.anim = "parado";
  elenco.atualizar(r.uid, r.nome, r);
}

function pacoteTerreno(): Msg["ter"] {
  const t = terreno.tomarTudo();
  return t ? { i0: t.i0, i1: t.i1, j0: t.j0, j1: t.j1, mm: mmParaBuffer(t.mm) } : undefined;
}

function entrouConvidado(l: Ligado): void {
  let r = registros.get(l.uid);
  if (!r) {
    const inicio = corpoParaMundo(4.2 + (registros.size % 4) * 1.1, 1.2 + Math.floor((registros.size + 1) / 4) * 1.3);
    r = { uid: l.uid, nome: l.nome, x: inicio.x, y: terreno.altura(inicio.x, inicio.z), z: inicio.z, rumo: carro.rumo + Math.PI / 2, anim: "parado", esc: 1, ligado: true, ausente: 0 };
    registros.set(l.uid, r);
  }
  r.nome = l.nome;
  r.av = personagemValido(l.av);
  r.ligado = true;
  r.ausente = 0;
  elenco.atualizar(r.uid, r.nome, r);
  anfitriao?.enviar(l.uid, { t: "bem", ter: pacoteTerreno(), x: r.x, y: r.y, z: r.z, rumo: r.rumo });
  aviso(`👷 ${l.nome} entrou na obra`, 2.5);
  anunciarVoz();
}

function saiuConvidado(l: Ligado): void {
  const r = registros.get(l.uid);
  if (!r) return;
  r.ligado = false;
  r.ausente = Date.now();
  entradasRemotas.delete(l.uid);
  anunciarVoz();
}

function mensagemDoConvidado(l: Ligado, m: Msg): void {
  const r = registros.get(l.uid);
  if (!r) return;
  const recusar = (msg: string): void => anfitriao?.enviar(l.uid, { t: "recusa", msg });
  switch (m.t) {
    case "p":
      if (condutor === l.uid || condutorCam === l.uid) break; // sentado, quem manda na posição é o veículo
      if (m.mt === 1) {
        r.nela = { v: m.v === "cam" ? "cam" : "maq", lx: num(m.lx, 10), lz: num(m.lz, 10), ly: num(m.ly, 10), lr: num(m.lr, 1000) };
        posicionarNela(r);
      } else {
        r.nela = undefined;
        r.x = num(m.x, 60);
        r.y = num(m.y, 60);
        r.z = num(m.z, 60);
        r.rumo = num(m.rumo, 1000);
      }
      r.av = personagemValido(m.av);
      r.anim = String(m.anim || "parado").slice(0, 24);
      r.esc = num(m.esc, 10) || 1;
      elenco.atualizar(r.uid, r.nome, r);
      break;
    case "c":
      if (condutor !== l.uid && condutorCam !== l.uid) break;
      entradasRemotas.set(l.uid, {
        e: {
          acel: num(m.acel, 1), virar: num(m.virar, 1), freio: num(m.freio, 1), giro: num(m.giro, 1), lanca: num(m.lanca, 1),
          braco: num(m.braco, 1), concha: num(m.concha, 1), bracoF: num(m.bracoF, 1), conchaF: num(m.conchaF, 1), bascula: num(m.bascula, 1),
        },
        t: performance.now(),
      });
      break;
    case "entrar": {
      if (condutor === l.uid || condutorCam === l.uid) break;
      const v: Veiculo = m.v === "cam" ? "cam" : "maq";
      if (condutorDe(v) !== "") return recusar(`Outro operário está ${v === "maq" ? "na" : "no"} ${NOME_VEICULO[v]}`);
      const porta = portaDe(v);
      const pp = noCorpo(v, porta.x + 0.4, porta.z);
      if (Math.hypot(r.x - pp.x, r.z - pp.z) > 3.2) return recusar("Chegue perto da porta (lado esquerdo) para entrar");
      r.nela = undefined;
      definirCondutorDe(v, l.uid);
      entradasRemotas.delete(l.uid);
      break;
    }
    case "sair": {
      const v: Veiculo | "" = condutor === l.uid ? "maq" : condutorCam === l.uid ? "cam" : "";
      if (!v) break;
      if (Math.abs(poseDe(v).vel) > 0.8) return recusar(v === "maq" ? "Pare a máquina antes de sair" : "Pare o caminhão antes de sair");
      liberarCabine(r);
      break;
    }
    case "modo":
      if (condutor !== l.uid) break;
      if (modo === "dirigir" && Math.abs(carro.vel) > 0.6) return recusar("Pare a máquina antes de escavar");
      definirModo(modo === "dirigir" ? "escavar" : "dirigir");
      break;
  }
}

// ----- convidado -----
function receberDoAnfitriao(m: Msg): void {
  if (m.t === "versao") {
    // a sala roda outra versão do jogo (o mapa mudou): sem recarregar, o terreno não combina
    $("rede-estado").textContent = "⚠️ Esta sala usa outra versão do jogo. Recarregue a página (Ctrl+F5) e entre de novo.";
    $("rede-estado").classList.remove("escondido");
    estadoMenu("Esta sala usa outra versão do jogo. Recarregue a página (Ctrl+F5).", true);
    convidado?.fechar();
    convidado = null;
    menuOcupado(false);
  } else if (m.t === "voz") {
    rosterVoz = m.pares as ParVoz[];
    sincronizarVoz();
  } else if (m.t === "recusa") {
    aviso(String(m.msg), 2.2);
  } else if (m.t === "bem") {
    aplicarTerreno(m.ter);
    if (!jaEntrou) {
      // primeira vez nesta página: nasce onde o anfitrião diz (a vaga dele, ou onde estava antes de cair)
      jaEntrou = true;
      op.x = num(m.x, 60);
      op.y = num(m.y, 60);
      op.z = num(m.z, 60);
      op.rumo = num(m.rumo, 1000);
      op.grupo.position.set(op.x, op.y, op.z);
      op.grupo.rotation.y = op.rumo;
      orbita.yaw = op.rumo + Math.PI;
      orbita.pitch = 0.3;
      orbita.dist = 7;
    }
    primeiroEstado = true;
    $("rede-estado").classList.add("escondido");
    guardarSessao("convidado", convidado!.palavra);
    mostrarPainelSala(convidado!.palavra);
    comecar();
  } else if (m.t === "s") {
    if (!estadoValido(m)) return;
    alvoRede = m;
    aplicarTerreno(m.ter);
    for (const q of (m.pt as number[][]) ?? []) particulas.emitir(new THREE.Vector3(q[0], q[1], q[2]), new THREE.Vector3(q[3], q[4], q[5]), 0, q[6]);
    // quem está na cabine manda; se o anfitrião disse que sou eu (ou que não sou mais), acompanha
    condutor = String(m.k ?? "");
    condutorCam = String(m.kc ?? "");
    const meu: Veiculo | "" = condutor === meuUid ? "maq" : condutorCam === meuUid ? "cam" : "";
    if (meu && aPe) sentar(meu);
    else if (!meu && !aPe) levantar();
    definirModo(m.m ? "escavar" : "dirigir");
    const vistos = new Set<string>();
    for (const q of (m.jog as [string, string, number, number, number, number, string, number, string][]) ?? []) {
      if (q[0] === meuUid) continue;
      vistos.add(q[0]);
      elenco.atualizar(q[0], q[1], { x: q[2], y: q[3], z: q[4], rumo: q[5], anim: q[6], esc: q[7], av: q[8] });
    }
    elenco.manter(vistos);
  }
}

// o pacote de estado tem números normais? (bobagem da rede nunca vira a pose da máquina)
function estadoValido(m: Msg): boolean {
  const c = m.c as number[] | undefined;
  const j = m.j as number[] | undefined;
  const ok = (v: unknown, lim: number): boolean => typeof v === "number" && isFinite(v) && Math.abs(v) <= lim;
  const tc = m.tc as number[] | undefined;
  return !!c && !!j && !!tc && c.length === 8 && j.length === 7 && tc.length === 8 && c.every((v, n) => ok(v, n === 3 ? 1e5 : 100)) && tc.every((v, n) => ok(v, n === 3 ? 1e5 : 100)) && j.every((v) => ok(v, 20)) && ok(m.b, 1e3) && ok(m.bc, 2) && ok(m.cr, 100) && ok(m.cf, 100) && ok(m.v, 1e5);
}

function aplicarTerreno(t: unknown): void {
  const a = t as { i0: number; i1: number; j0: number; j1: number; mm: unknown } | undefined;
  if (a) terreno.aplicarAlteracao(a.i0, a.i1, a.j0, a.j1, bufferParaMm(a.mm));
}

// acompanha a pose da máquina que o anfitrião mandou (suavizando entre um pacote e outro)
function aplicarEstadoRede(dt: number): void {
  const a = alvoRede;
  if (!a) return;
  const c = a.c as number[];
  const j = a.j as number[];
  const f = primeiroEstado ? 1 : THREE.MathUtils.clamp(1 - Math.exp(-dt * 14), 0, 1);
  primeiroEstado = false;
  carro.x += (c[0] - carro.x) * f;
  carro.y += (c[1] - carro.y) * f;
  carro.z += (c[2] - carro.z) * f;
  carro.rumo += Math.atan2(Math.sin(c[3] - carro.rumo), Math.cos(c[3] - carro.rumo)) * f;
  carro.vel += (c[4] - carro.vel) * f;
  carro.esterco += (c[5] - carro.esterco) * f;
  carro.arfagem += (c[6] - carro.arfagem) * f;
  carro.rolagem += (c[7] - carro.rolagem) * f;
  const junta = ["giro", "lanca", "braco", "concha", "bracoFrente", "conchaFrente", "sapatas"] as const;
  let mexeu = 0;
  junta.forEach((nome, n) => {
    const antes = maq[nome];
    maq[nome] += (j[n] - antes) * f;
    mexeu += Math.abs(maq[nome] - antes);
  });
  hidrRede = dt > 0 ? mexeu / dt : 0;
  maq.banco.rotation.y += ((a.b as number) - maq.banco.rotation.y) * f;
  maq.retro.carga = a.cr as number;
  maq.frente.carga = a.cf as number;
  if (caminhao.volume !== a.v) caminhao.definirVolume(a.v as number);
  maq.atualizarPose();
  posicionarMaquina(dt);
  // caminhão
  const t = a.tc as number[];
  carroCam.x += (t[0] - carroCam.x) * f;
  carroCam.y += (t[1] - carroCam.y) * f;
  carroCam.z += (t[2] - carroCam.z) * f;
  carroCam.rumo += Math.atan2(Math.sin(t[3] - carroCam.rumo), Math.cos(t[3] - carroCam.rumo)) * f;
  carroCam.vel += (t[4] - carroCam.vel) * f;
  carroCam.esterco += (t[5] - carroCam.esterco) * f;
  carroCam.arfagem += (t[6] - carroCam.arfagem) * f;
  carroCam.rolagem += (t[7] - carroCam.rolagem) * f;
  caminhao.inclinacao += ((a.bc as number) - caminhao.inclinacao) * f;
  posicionarCaminhao(dt);
}

function enviarControle(dt: number, e: Entrada): void {
  tControle -= dt;
  if (tControle > 0) return;
  tControle = 0.05;
  convidado?.enviar({ t: "c", ...e });
}

// ----- obra salva (no navegador do anfitrião, por palavra) -----
const chaveObra = (palavra: string): string => `retro-obra2-${palavra}`; // v2: o terreno cresceu (120 m), obras salvas antes não servem

function salvarObra(palavra: string): void {
  const t = terreno.tomarTudo();
  const dados = { ter: t ? { i0: t.i0, i1: t.i1, j0: t.j0, j1: t.j1, mm: mmParaTexto(t.mm) } : null, carro: { x: carro.x, z: carro.z, rumo: carro.rumo }, cam: { x: carroCam.x, z: carroCam.z, rumo: carroCam.rumo }, vol: caminhao.volume };
  try {
    localStorage.setItem(chaveObra(palavra), JSON.stringify(dados));
    obraSuja = false;
    volumeSalvo = caminhao.volume;
  } catch {
    /* sem espaço: segue sem salvar */
  }
}

function restaurarObra(palavra: string): void {
  try {
    const bruto = localStorage.getItem(chaveObra(palavra));
    if (!bruto) return;
    const d = JSON.parse(bruto);
    if (d.ter) terreno.aplicarAlteracao(d.ter.i0, d.ter.i1, d.ter.j0, d.ter.j1, textoParaMm(d.ter.mm));
    carro.x = num(d.carro?.x, 60);
    carro.z = num(d.carro?.z, 60);
    carro.rumo = num(d.carro?.rumo, 1e5);
    carro.y = terreno.altura(carro.x, carro.z);
    if (d.cam) {
      carroCam.x = num(d.cam.x, 60);
      carroCam.z = num(d.cam.z, 60);
      carroCam.rumo = num(d.cam.rumo, 1e5);
      carroCam.y = terreno.altura(carroCam.x, carroCam.z);
      posicionarCaminhao(0);
    }
    caminhao.definirVolume(num(d.vol, 1e4));
    volumeSalvo = caminhao.volume;
    posicionarMaquina(0);
    colocarOperarioInicial();
  } catch {
    /* obra salva corrompida: começa do zero */
  }
}

// ----- menu e painel da sala -----
const chaveSessao = "retro-sessao";
const campoPalavra = $("palavra") as HTMLInputElement;
const campoNome = $("nome-jogador") as HTMLInputElement;

function guardarSessao(como: Papel, palavra: string): void {
  try {
    localStorage.setItem(chaveSessao, JSON.stringify({ papel: como, palavra }));
  } catch {
    /* ignora */
  }
}

function uidSalvo(): string {
  try {
    let uid = localStorage.getItem("retro-uid");
    if (!uid) {
      uid = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("retro-uid", uid);
    }
    return uid;
  } catch {
    return `t${Math.random().toString(16).slice(2, 12)}`;
  }
}

function estadoMenu(texto: string, erro = false): void {
  $("sala-estado").textContent = texto;
  $("sala-estado").classList.toggle("erro", erro);
}

function menuOcupado(ocupado: boolean): void {
  for (const id of ["jogar", "bt-entrar-sala", "bt-sortear"]) ($(id) as HTMLButtonElement).disabled = ocupado;
  campoPalavra.disabled = campoNome.disabled = ocupado;
  $("bt-cancelar-sala").classList.toggle("escondido", !ocupado);
}

function fecharSala(): void {
  anfitriao?.fechar();
  convidado?.fechar();
  anfitriao = convidado = null;
  voz.fecharTudo();
  rosterVoz = [];
  condutorCam = "";
  entradasRemotas.clear();
  papel = "solo";
  meuUid = UID_ANFITRIAO;
  particulas.aoEmitir = null;
  registros.clear();
  elenco.limpar();
  condutor = "";
  menuOcupado(false);
  $("painel-sala").classList.add("escondido");
}

function mostrarPainelSala(palavra: string): void {
  $("sala-palavra").textContent = palavra;
  $("painel-sala").classList.remove("escondido");
  atualizarPainelSala();
}

let assinaturaPainel = "";
function atualizarPainelSala(): void {
  const todos: [string, string][] = [[meuUid, `${meuNome} (você)`], ...elenco.nomes];
  const peerDe = (uid: string): string => rosterVoz.find((p) => p.uid === uid)?.peerId ?? "";
  const assinatura = todos.map(([uid, nome]) => `${uid}|${nome}|${uid === condutor}|${uid === condutorCam}|${registros.get(uid)?.ligado === false}|${voz.estaSilenciado(peerDe(uid))}|${!!peerDe(uid)}`).join(";") + `|${voz.microfone}`;
  $("bt-mic").textContent = voz.microfone ? "🎙 Mic" : "🎤 Mic";
  $("bt-mic").classList.toggle("ligado", voz.microfone);
  if (assinatura === assinaturaPainel) return; // só refaz a lista quando algo mudou (senão os botões piscam)
  assinaturaPainel = assinatura;
  const lista = $("sala-jogadores");
  lista.replaceChildren();
  for (const [uid, nome] of todos) {
    const linha = document.createElement("div");
    linha.className = "jogador";
    linha.dataset.uid = uid;
    const fora = registros.get(uid)?.ligado === false ? " 💤" : "";
    const rotulo = document.createElement("span");
    rotulo.textContent = `${uid === condutor ? "🚜" : uid === condutorCam ? "🚚" : "👷"} ${nome}${fora}`;
    linha.appendChild(rotulo);
    const peer = peerDe(uid);
    if (uid !== meuUid && peer) {
      const mudo = voz.estaSilenciado(peer);
      const bt = document.createElement("button");
      bt.className = "mudo-btn";
      bt.textContent = mudo ? "🔇" : "🔊";
      bt.title = mudo ? `Reativar o som de ${nome}` : `Silenciar ${nome}`;
      bt.addEventListener("click", () => {
        voz.silenciar(peer, !voz.estaSilenciado(peer));
        assinaturaPainel = "";
        atualizarPainelSala();
      });
      linha.appendChild(bt);
    }
    lista.appendChild(linha);
  }
}

// Uma ação só: digitou a palavra, entrou. Primeiro tenta abrir a sala (ser quem hospeda a obra); se a palavra já
// tem dono, entra nela como convidado. Quem era o dono e recarregou a página insiste um pouco antes de desistir.
function abrirSala(): void {
  const palavra = normalizarPalavra(campoPalavra.value);
  if (palavra.length < 2) {
    estadoMenu("Digite a palavra da sala (2 a 16 letras ou números)", true);
    return;
  }
  campoPalavra.value = palavra;
  meuNome = campoNome.value.trim().slice(0, 16) || "Operário";
  let eraDono = false;
  try {
    localStorage.setItem("retro-nome", meuNome);
    const antes = JSON.parse(localStorage.getItem(chaveSessao) ?? "null");
    eraDono = antes?.papel === "anfitriao" && antes?.palavra === palavra;
  } catch {
    /* ignora */
  }
  gestoInicial();
  fecharSala();
  menuOcupado(true);
  estadoMenu("Procurando a sala...");
  entrarComoAnfitriao(palavra, eraDono);
}

function entrarComoAnfitriao(palavra: string, insistir: boolean): void {
  papel = "anfitriao";
  meuUid = UID_ANFITRIAO;
  anfitriao = new Anfitriao(
    palavra,
    {
      aoAbrir: () => {
        if (jogando) return;
        restaurarObra(palavra);
        particulas.aoEmitir = (p, v, tam) => {
          if (anfitriao && anfitriao.ligados.size > 0 && pendentesPt.length < 400) pendentesPt.push([p.x, p.y, p.z, v.x, v.y, v.z, tam]);
        };
        guardarSessao("anfitriao", palavra);
        mostrarPainelSala(palavra);
        comecar();
      },
      aoErro: (tipo) => {
        if (jogando) return; // com a sala aberta, falha de rede o PeerJS religa sozinho
        if (tipo === "palavra-em-uso") {
          anfitriao?.fechar();
          anfitriao = null;
          entrarComoConvidado(palavra);
          return;
        }
        estadoMenu(`Não deu para abrir a sala (${tipo}). Confira a internet.`, true);
        fecharSala();
      },
      aoEntrou: entrouConvidado,
      aoSaiu: saiuConvidado,
      aoMensagem: mensagemDoConvidado,
      aoChamada: aoChamadaVoz,
    },
    insistir,
  );
}

function entrarComoConvidado(palavra: string): void {
  papel = "convidado";
  meuUid = uidSalvo();
  estadoMenu("Entrando na sala...");
  convidado = new Convidado(palavra, meuUid, meuNome, {
    aoConectar: () => {
      if (!jogando) estadoMenu("Entrando na obra...");
    },
    aoDesconectar: () => {
      $("rede-estado").textContent = "🔌 Sem conexão com a sala. Tentando voltar...";
      $("rede-estado").classList.remove("escondido");
    },
    aoMensagem: receberDoAnfitriao,
    aoChamada: aoChamadaVoz,
    aoEstado: (texto) => {
      if (!jogando) estadoMenu(texto);
      else {
        $("rede-estado").textContent = `🔌 ${texto}`;
        $("rede-estado").classList.remove("escondido");
      }
    },
  });
  convidado.av = meuPersonagem;
}

$("bt-entrar-sala").addEventListener("click", abrirSala);
$("bt-sortear").addEventListener("click", () => {
  campoPalavra.value = palavraAleatoria();
  campoPalavra.dispatchEvent(new Event("input"));
});
campoPalavra.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") abrirSala();
});
campoNome.addEventListener("keydown", (e) => {
  e.stopPropagation();
  if (e.key === "Enter") abrirSala();
});
$("bt-cancelar-sala").addEventListener("click", () => {
  fecharSala();
  estadoMenu("");
});
$("bt-apagar-obra").addEventListener("click", () => {
  try {
    localStorage.removeItem(chaveObra(normalizarPalavra(campoPalavra.value)));
  } catch {
    /* ignora */
  }
  $("bt-apagar-obra").classList.add("escondido");
  estadoMenu("Obra apagada: a sala começa do zero.");
});
campoPalavra.addEventListener("input", () => {
  let salva = false;
  try {
    salva = !!localStorage.getItem(chaveObra(normalizarPalavra(campoPalavra.value)));
  } catch {
    /* ignora */
  }
  $("bt-apagar-obra").classList.toggle("escondido", !salva);
});
$("bt-link").addEventListener("click", () => {
  const link = `${location.origin}${location.pathname}?sala=${$("sala-palavra").textContent}`;
  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(link).then(() => aviso("🔗 Link copiado", 1.8));
  else window.prompt("Copie o link da sala:", link);
});
$("bt-sair-sala").addEventListener("click", () => {
  try {
    localStorage.removeItem(chaveSessao);
  } catch {
    /* ignora */
  }
  location.href = location.pathname; // recarrega sem a sala
});

// ----- voz -----
// Malha completa de chamadas de áudio (como no CS Caps): o anfitrião publica quem está na sala (id de cada um no servidor do
// PeerJS) e cada jogador liga para os de uid menor. Todos ouvem desde o início; o microfone abre no primeiro toque (o navegador
// só deixa pedir a permissão depois de um gesto) e só fica desligado se a pessoa desligar.
interface ParVoz { uid: string; peerId: string; nome: string }
let rosterVoz: ParVoz[] = [];
const voz = new Voz({ aoMudar: () => { assinaturaPainel = ""; atualizarPainelSala(); } });
voz.definirVolume(ajustes.volumeVoz);

function anunciarVoz(): void {
  if (!anfitriao) return;
  rosterVoz = [{ uid: UID_ANFITRIAO, peerId: anfitriao.peerId, nome: meuNome }, ...[...anfitriao.ligados.values()].map((l) => ({ uid: l.uid, peerId: l.conn.peer, nome: l.nome }))];
  anfitriao.transmitir({ t: "voz", pares: rosterVoz });
  sincronizarVoz();
}

function sincronizarVoz(): void {
  if (!Voz.suportado() || papel === "solo" || !jogando) return;
  const meuPeer = anfitriao?.peerId ?? convidado?.peerId;
  if (!meuPeer) return;
  const outros = rosterVoz.filter((p) => p.peerId !== meuPeer);
  voz.manter("sala", outros.map((p) => p.peerId));
  for (const p of outros) {
    if (meuUid > p.uid && !voz.temLigacao(p.peerId)) {
      const call = anfitriao ? anfitriao.ligar(p.peerId, voz.fluxo) : convidado?.ligar(p.peerId, voz.fluxo) ?? null;
      if (call) voz.chamou(call, "sala");
    }
  }
}

function aoChamadaVoz(call: MediaConnection): void {
  if (!Voz.suportado() || papel === "solo") { call.close(); return; }
  if (rosterVoz.length > 0 && !rosterVoz.some((p) => p.peerId === call.peer)) { call.close(); return; } // só quem está na sala
  voz.atender(call, "sala");
}

const CHAVE_MIC_DESLIGADO = "retro-mic-desligado";
const micDesligadoPorMim = (): boolean => {
  try {
    return localStorage.getItem(CHAVE_MIC_DESLIGADO) === "1";
  } catch {
    return false;
  }
};

async function alternarMic(): Promise<void> {
  const erro = await voz.alternarMicrofone();
  if (!erro) {
    try {
      if (voz.microfone) localStorage.removeItem(CHAVE_MIC_DESLIGADO);
      else localStorage.setItem(CHAVE_MIC_DESLIGADO, "1");
    } catch {
      /* ignora */
    }
  }
  aviso(erro ?? (voz.microfone ? "🎙 Microfone ligado: os outros ouvem você" : "🎤 Microfone desligado"), erro ? 4 : 2);
}

let tentouMicAuto = false;
async function ligarMicAutomatico(): Promise<void> {
  if (tentouMicAuto || papel === "solo" || !jogando || voz.microfone || micDesligadoPorMim() || !Voz.suportado()) return;
  tentouMicAuto = true;
  const erro = await voz.alternarMicrofone();
  aviso(erro ?? "🎙 Microfone ligado: os outros ouvem você (V desliga)", erro ? 4 : 3);
}

// quem está falando: marca a linha na lista da sala
function indicadoresVoz(): void {
  voz.atualizarNiveis();
  if (papel === "solo") return;
  const falando = new Set(voz.participantes().filter((p) => p.falando).map((p) => p.peerId));
  for (const linha of document.querySelectorAll<HTMLElement>("#sala-jogadores .jogador")) {
    const uid = linha.dataset.uid ?? "";
    const peer = rosterVoz.find((p) => p.uid === uid)?.peerId ?? "";
    linha.classList.toggle("falando", uid === meuUid ? voz.euFalando : falando.has(peer));
  }
}
$("bt-mic").addEventListener("click", () => void alternarMic());
// o navegador só toca áudio depois de um gesto: retoma a cada toque/clique
for (const ev of ["pointerdown", "click", "keydown"]) document.addEventListener(ev, () => { voz.retomar(); void ligarMicAutomatico(); }, { capture: true });
window.setInterval(indicadoresVoz, 100);
window.setInterval(() => { if (anfitriao) anunciarVoz(); else sincronizarVoz(); }, 2500);

// ao abrir a página: nome de antes, palavra do link (?sala=) ou da última sala (para voltar com um toque)
{
  let nome = "";
  let sessao: { papel: Papel; palavra: string } | null = null;
  try {
    nome = localStorage.getItem("retro-nome") ?? "";
    sessao = JSON.parse(localStorage.getItem(chaveSessao) ?? "null");
  } catch {
    /* ignora */
  }
  campoNome.value = nome;
  const doLink = normalizarPalavra(new URLSearchParams(location.search).get("sala") ?? "");
  if (doLink) {
    campoPalavra.value = doLink;
    estadoMenu(`Convite para a sala "${doLink}": escreva seu nome e toque em Entrar na sala.`);
  } else if (sessao?.palavra) {
    campoPalavra.value = sessao.palavra;
    estadoMenu(`↩️ Sua última sala: "${sessao.palavra}". Toque em Entrar na sala para voltar.`);
  }
  campoPalavra.dispatchEvent(new Event("input"));
}

// ---------------- laço ----------------
carro.y = terreno.altura(carro.x, carro.z);
carroCam.y = terreno.altura(carroCam.x, carroCam.z);
// o operário começa ao lado da máquina, olhando para a porta da cabine (`vaga` afasta os que chegam depois)
function colocarOperarioInicial(vaga = 0): void {
  const inicio = corpoParaMundo(4.2 + (vaga % 4) * 1.1, 1.2 + Math.floor(vaga / 4) * 1.3);
  const porta = corpoParaMundo(maq.porta.x, maq.porta.z);
  op.x = inicio.x;
  op.z = inicio.z;
  op.rumo = Math.atan2(porta.x - op.x, porta.z - op.z);
  op.y = terreno.altura(op.x, op.z);
  op.grupo.position.set(op.x, op.y, op.z);
  op.grupo.rotation.y = op.rumo;
  orbita.yaw = op.rumo + Math.PI;
  orbita.pitch = 0.3;
  orbita.dist = 7;
}
colocarOperarioInicial();
let ultimo = performance.now();
function quadro(agora: number): void {
  const dt = Math.max(0, Math.min(0.05, (agora - ultimo) / 1000)); // nunca negativo: dt < 0 faz as suavizações divergirem
  ultimo = agora;
  atualizarMaquina(dt);
  carregarPassageiro();
  if (papel === "anfitriao") acompanharPassageiros();
  op.atualizar(dt);
  particulas.atualizar(dt, terreno, caminhao);
  elenco.animar(dt, condutor, condutorCam);
  tickRede(dt);
  terreno.atualizar(dt);
  atualizarCamera(dt);
  atualizarHud(dt);
  renderer.render(cena, camera);
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);

// para testes automáticos
(window as unknown as { jogo: unknown }).jogo = { LOTES, favela, camera, alvoCam, posCam, maq, carro, terreno, caminhao, teclas, orbita, op, entrarOuSair, get aPe() { return aPe; }, get papel() { return papel; }, voz, get roster() { return rosterVoz; }, get montado() { return montado; }, get condutor() { return condutor; }, get condutorCam() { return condutorCam; }, carroCam, get veiculo() { return veiculo; }, get jogando() { return jogando; }, get modo() { return modo; }, trocarModo, iniciar: () => $("jogar").click() };
