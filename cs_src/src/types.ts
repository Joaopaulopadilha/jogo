// types.ts
// Tipos compartilhados entre host, convidados e renderer

export type Vec3 = [number, number, number];

export interface PlayerInfo {
  id: number;
  nome: string;
  cor: string;
}

// comando de entrada de um frame; o host aplica na ordem em que chegam
export interface Cmd {
  seq: number;
  dt: number;
  fwd: number;    // -1..1
  strafe: number; // -1..1
  jump: boolean;
  yaw: number;
  pitch: number;
  fire: boolean;
  reload: boolean;
  arma: number;   // slot selecionado: 0 rifle, 1 pistola, 2 granada
}

export interface PlayerSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  vy: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  on: boolean; // conectado
  arma: number;
  am: number[]; // munição de cada arma de fogo
  gr: number;   // granadas restantes
  reloading: boolean;
  ack: number; // último seq processado (reconciliação do convidado)
  wins: number;
  kills: number;
  deaths: number;
}

export interface GranadaSnap {
  id: number;
  x: number;
  y: number;
  z: number;
}

export type Phase = "warmup" | "live" | "roundEnd" | "matchEnd";

export interface Snapshot {
  phase: Phase;
  timer: number;
  round: number;
  winner: number; // id do vencedor, -1 nenhum, -2 empate
  ps: PlayerSnap[];
  gs: GranadaSnap[];
}

export interface ShotMsg {
  t: "shot";
  i: number;      // atirador
  w: number;      // arma usada
  o: Vec3;        // origem (olho)
  e: Vec3;        // ponto final
  h: number;      // id atingido, -1 se nada
  hs: boolean;    // headshot
}

export interface KillMsg {
  t: "kill";
  killer: number;
  victim: number;
  w: number;      // arma (2 = granada)
  head: boolean;
}

export interface BoomMsg {
  t: "boom";
  x: number;
  y: number;
  z: number;
}

export type HostMsg =
  | { t: "lobby"; players: PlayerInfo[]; you: number }
  | { t: "start"; players: PlayerInfo[]; you: number }
  | { t: "snap"; s: Snapshot }
  | ShotMsg
  | KillMsg
  | BoomMsg
  | { t: "voz"; pares: { pid: number; peerId: string }[] }; // quem está na sala (para ligar as chamadas de voz)

export type GuestMsg =
  | { t: "hello"; nome: string; slot?: number } // slot: posição no grupo de amigos (define cor e vaga na partida)
  | { t: "cmds"; cmds: Cmd[] };
