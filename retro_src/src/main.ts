import * as THREE from "three";
import "./style.css";
import { Terreno } from "./terreno";
import { Retroescavadeira, LIMITES, Concha } from "./maquina";
import { montarCenario, VALA } from "./cenario";
import { Particulas } from "./particulas";
import { Som } from "./som";
import { Manche, botaoSegurar, ehToque } from "./toque";

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
const { sol, caminhao } = montarCenario(cena, terreno);
const maq = new Retroescavadeira();
cena.add(maq.raiz);
const particulas = new Particulas();
cena.add(particulas.malha);
const som = new Som();
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
// velocidade atual de cada articulação (o hidráulico acelera e freia suave)
const taxa: Record<string, number> = { giro: 0, lanca: 0, braco: 0, concha: 0, bracoFrente: 0, conchaFrente: 0 };
const VEL_JUNTA: Record<string, number> = { giro: 0.75, lanca: 0.55, braco: 0.75, concha: 1.1, bracoFrente: 0.45, conchaFrente: 0.9 };
let jogando = false;
let cameraCabine = false;
let volumeCaminhao = 0;
let progresso = 0;
let valaPronta = false;
let tempoMissao = 0;
let somTerra = 0;

// ---------------- entrada ----------------
const teclas = new Set<string>();
addEventListener("keydown", (e) => {
  if (!jogando) return;
  if (e.code === "Tab") {
    e.preventDefault();
    trocarModo();
  } else if (e.code === "KeyC") cameraCabine = !cameraCabine;
  else if (e.code === "KeyH") document.getElementById("ajuda")!.classList.toggle("escondido");
  else if (e.code === "KeyM") som.ligado = !som.ligado;
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
  teclas.add(e.code);
});
addEventListener("keyup", (e) => teclas.delete(e.code));
addEventListener("blur", () => teclas.clear());
const k = (c: string) => (teclas.has(c) ? 1 : 0);

let botaoYAntes = false;
function controle(): Gamepad | null {
  for (const g of navigator.getGamepads?.() ?? []) if (g && g.connected) return g;
  return null;
}
const zona = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);

// câmera orbital: arrastar (mouse ou dedo) gira, rodinha ou pinça com dois dedos aproxima
const orbita = { yaw: 0, pitch: 0.38, dist: 15 };
const dedos = new Map<number, { x: number; y: number }>();
let pinca = 0;
canvas.addEventListener("pointerdown", (e) => {
  dedos.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
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
  if (!antes) return;
  const dx = e.clientX - antes.x;
  const dy = e.clientY - antes.y;
  antes.x = e.clientX;
  antes.y = e.clientY;
  if (dedos.size >= 2) {
    const [a, b] = [...dedos.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinca > 0) orbita.dist = THREE.MathUtils.clamp(orbita.dist * (pinca / d), 5, 40);
    pinca = d;
    return;
  }
  const k = e.pointerType === "touch" ? 0.008 : 0.005;
  orbita.yaw -= dx * k;
  orbita.pitch = THREE.MathUtils.clamp(orbita.pitch + dy * k * 0.8, cameraCabine ? -0.8 : 0.05, cameraCabine ? 0.8 : 1.35);
});
canvas.addEventListener("wheel", (e) => {
  orbita.dist = THREE.MathUtils.clamp(orbita.dist * (1 + Math.sign(e.deltaY) * 0.1), 5, 40);
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------------- HUD ----------------
const $ = (id: string) => document.getElementById(id)!;
const AJUDA: Record<Modo, string> = {
  dirigir: `<div class="titulo">🚗 Dirigir</div>
    <b>W / S</b> acelerar / ré<br><b>A / D</b> virar<br><b>Espaço</b> freio<br>
    <b>R / F</b> sobe / desce a pá da frente<br><b>T / G</b> recolhe / despeja a pá<br>
    <div class="rodape"><b>Tab</b> parar e escavar · <b>C</b> câmera · <b>M</b> som</div>`,
  escavar: `<div class="titulo">⛏️ Escavar (braço traseiro)</div>
    <b>W / S</b> sobe / desce a lança<br><b>A / D</b> gira para a esquerda / direita<br>
    <b>↑ / ↓</b> ou <b>I / K</b> estica / recolhe o braço<br><b>← / →</b> ou <b>J / L</b> fecha / abre a concha<br>
    <div class="rodape"><b>Tab</b> dirigir · <b>C</b> câmera · <b>M</b> som</div>`,
};
let avisoTempo = 0;
function aviso(texto: string, segundos = 2.2): void {
  $("aviso").textContent = texto;
  $("aviso").classList.remove("escondido");
  avisoTempo = segundos;
}

function trocarModo(): void {
  if (modo === "dirigir") {
    if (Math.abs(carro.vel) > 0.6) {
      aviso("Pare a máquina antes de escavar");
      return;
    }
    modo = "escavar";
    // de lado e um pouco atrás: a pá da frente não tampa o braço
    orbita.yaw = 0.75;
    orbita.pitch = 0.5;
    orbita.dist = 11;
  } else {
    modo = "dirigir";
    orbita.yaw = 0;
    orbita.pitch = 0.38;
    orbita.dist = 15;
  }
  $("modo").textContent = modo === "dirigir" ? "🚗 Dirigindo" : "⛏️ Escavando";
  $("ajuda").innerHTML = AJUDA[modo];
  rotularToque();
}
$("ajuda").innerHTML = AJUDA[modo];

// ---------------- toque (celular e tablet) ----------------
const mancheEsq = new Manche($("manche-esq"));
const mancheDir = new Manche($("manche-dir"));
const freioToque = botaoSegurar($("bt-freio"));
function rotularToque(): void {
  document.body.classList.toggle("modo-escavar", modo === "escavar");
  $("bt-modo").textContent = modo === "dirigir" ? "⛏️ Escavar" : "🚗 Dirigir";
  if (modo === "dirigir") {
    mancheEsq.rotular("acelerar", "ré", "◀", "▶");
    mancheDir.rotular("pá sobe", "pá desce", "recolhe", "despeja");
  } else {
    mancheEsq.rotular("estica braço", "recolhe braço", "gira", "gira");
    mancheDir.rotular("sobe lança", "desce lança", "fecha", "abre");
  }
}
rotularToque();
$("bt-modo").addEventListener("click", () => trocarModo());
$("bt-camera").addEventListener("click", () => (cameraCabine = !cameraCabine));
$("bt-som").addEventListener("click", () => {
  som.ligado = !som.ligado;
  $("bt-som").textContent = som.ligado ? "🔊" : "🔇";
});
if (!document.documentElement.requestFullscreen) $("bt-tela").style.display = "none";
$("bt-tela").addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
});

$("jogar").addEventListener("click", () => {
  jogando = true;
  document.body.classList.add("jogando");
  $("inicio").classList.add("escondido");
  som.iniciar();
  if (TOQUE) {
    // no celular, entra em tela cheia e tenta travar na horizontal
    void document.documentElement.requestFullscreen?.().then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape")).catch(() => {});
  }
  aviso(TOQUE ? "Dê ré até a vala marcada e toque em ⛏️ Escavar" : "Dê ré até a vala marcada e aperte Tab para escavar", 4);
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

  const alvoEsterco = virar * 0.6;
  carro.esterco += (alvoEsterco - carro.esterco) * Math.min(1, dt * 4);
  carro.rumo += (carro.vel * Math.tan(carro.esterco) / maq.entreEixos) * dt;
  carro.x += Math.sin(carro.rumo) * carro.vel * dt;
  carro.z += Math.cos(carro.rumo) * carro.vel * dt;
  carro.x = THREE.MathUtils.clamp(carro.x, -43, 43);
  carro.z = THREE.MathUtils.clamp(carro.z, -43, 43);
  const fora = caminhao.empurrar(carro.x, carro.z, 1.6);
  if (fora) {
    carro.x = fora.x;
    carro.z = fora.z;
    if (Math.abs(carro.vel) > 1.5) aviso("💥 Cuidado com o caminhão!");
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

  maq.raiz.position.set(carro.x, carro.y, carro.z);
  maq.raiz.rotation.y = carro.rumo;
  maq.corpo.rotation.set(-carro.arfagem, 0, carro.rolagem);
  for (const r of maq.rodas) {
    r.obj.rotation.x += (carro.vel * dt) / r.raio;
    if (r.dianteira) r.pivo.rotation.y = carro.esterco;
  }
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
  const gp = controle();
  let acel = 0, virar = 0, freio = 0;
  let giro = 0, lanca = 0, braco = 0, concha = 0, bracoF = 0, conchaF = 0;
  if (jogando) {
    if (modo === "dirigir") {
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
      if (modo === "dirigir") {
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
      if (modo === "dirigir") {
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
  }

  dirigir(dt, THREE.MathUtils.clamp(acel, -1, 1), THREE.MathUtils.clamp(virar, -1, 1), freio);
  const alvoSapatas = modo === "escavar" ? 1 : 0;
  maq.sapatas += THREE.MathUtils.clamp(alvoSapatas - maq.sapatas, -dt * 1.2, dt * 1.2);

  // articulações: se a concha entra fundo demais no chão (cheia ou no limite), o movimento volta
  const antes = salvarJuntas();
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
  if (r.travou || f.travou) {
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

  const giroMotor = Math.min(1, Math.abs(carro.vel) / 7 + Math.abs(acel) * 0.25 + Math.min(hidr, 1.5) * 0.35);
  som.atualizar(giroMotor, Math.min(1, hidr * 0.8), somTerra);
}

// ---------------- câmera ----------------
const alvoCam = new THREE.Vector3();
const posCam = new THREE.Vector3();
function atualizarCamera(dt: number): void {
  if (cameraCabine) {
    const assento = maq.assentoPos.getWorldPosition(new THREE.Vector3());
    const olhar = modo === "dirigir" ? carro.rumo : carro.rumo + Math.PI - maq.giro * 0.6;
    const yaw = olhar + orbita.yaw - (modo === "escavar" ? Math.PI : 0);
    camera.position.copy(assento).add(new THREE.Vector3(0, 0.15, 0));
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(orbita.pitch - 0.35), -Math.sin(orbita.pitch - 0.35) - (modo === "escavar" ? 0.25 : 0.05), Math.cos(yaw) * Math.cos(orbita.pitch - 0.35));
    camera.lookAt(camera.position.clone().add(dir));
    camera.fov = 70;
    camera.updateProjectionMatrix();
    return;
  }
  if (camera.fov !== 55) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
  const centro = new THREE.Vector3(carro.x, carro.y + 1.6, carro.z);
  if (modo === "escavar") {
    // olha entre a máquina e a concha
    const concha = maq.retro.ponta.getWorldPosition(new THREE.Vector3());
    centro.lerp(concha, 0.55);
  }
  const f = 1 - Math.exp(-dt * 6);
  alvoCam.lerp(centro, alvoCam.lengthSq() === 0 ? 1 : f);
  const yaw = carro.rumo + Math.PI + orbita.yaw;
  posCam.set(
    alvoCam.x + Math.sin(yaw) * Math.cos(orbita.pitch) * orbita.dist,
    alvoCam.y + Math.sin(orbita.pitch) * orbita.dist,
    alvoCam.z + Math.cos(yaw) * Math.cos(orbita.pitch) * orbita.dist,
  );
  posCam.y = Math.max(posCam.y, terreno.altura(posCam.x, posCam.z) + 0.8);
  camera.position.lerp(posCam, camera.position.lengthSq() === 0 ? 1 : Math.min(1, f * 1.5));
  camera.lookAt(alvoCam);
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
  $("velocidade").textContent = modo === "dirigir" ? `${Math.round(Math.abs(carro.vel) * 3.6)} km/h${carro.vel < -0.1 ? " (ré)" : ""}` : maq.sapatas < 1 ? "Baixando sapatas..." : "Sapatas no chão";
  $("barra-vala").style.width = `${Math.round(progresso * 100)}%`;
  $("missao-vala").textContent = `Vala: ${Math.round(progresso * 100)}%`;
  $("missao-caminhao").textContent = `Caminhão: ${volumeCaminhao.toFixed(1).replace(".", ",")} m³`;
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

// ---------------- laço ----------------
carro.y = terreno.altura(carro.x, carro.z);
let ultimo = performance.now();
function quadro(agora: number): void {
  const dt = Math.min(0.05, (agora - ultimo) / 1000);
  ultimo = agora;
  atualizarMaquina(dt);
  volumeCaminhao += particulas.atualizar(dt, terreno, caminhao);
  terreno.atualizar(dt);
  atualizarCamera(dt);
  atualizarHud(dt);
  renderer.render(cena, camera);
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);

// para testes automáticos
(window as unknown as { jogo: unknown }).jogo = { maq, carro, terreno, caminhao, teclas, orbita, get modo() { return modo; }, trocarModo, iniciar: () => $("jogar").click() };
