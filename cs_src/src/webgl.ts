// webgl.ts
// O que o navegador oferece de WebGL. Placas de vídeo antigas, máquinas virtuais e alguns navegadores só têm
// WebGL 1; o jogo usa o modo de compatibilidade (WebGL 1) nesses casos, em vez de nem abrir.

export interface SuporteWebGL {
  v1: boolean;
  v2: boolean;
}

function testar(nome: "webgl" | "webgl2"): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext(nome) as WebGLRenderingContext | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext(); // libera o contexto de teste
    return !!gl;
  } catch {
    return false;
  }
}

let cache: SuporteWebGL | null = null;

export function suporteWebGL(): SuporteWebGL {
  cache ??= { v1: testar("webgl"), v2: testar("webgl2") };
  return cache;
}

let vaoDesligado = false;

// Placas antigas (só WebGL 1) têm um defeito com a extensão de VAO: objetos criados depois do primeiro quadro
// (ex.: o personagem, ao confirmar o nome) simplesmente não aparecem. Sem a extensão, a biblioteca 3D usa o caminho
// comum, que funciona em todas elas. Só vale para WebGL 1: contextos WebGL 2 não são afetados.
export function desligarVAO(): void {
  if (vaoDesligado || typeof WebGLRenderingContext === "undefined") return;
  vaoDesligado = true;
  const proto = WebGLRenderingContext.prototype;
  const original = proto.getExtension as (this: WebGLRenderingContext, nome: string) => unknown;
  proto.getExtension = function (this: WebGLRenderingContext, nome: string) {
    return nome === "OES_vertex_array_object" ? null : original.call(this, nome);
  } as unknown as typeof proto.getExtension;
}

