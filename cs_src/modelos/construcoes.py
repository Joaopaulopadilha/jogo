# Casa e prédio semidestruídos do cenário do CS Caps.
# Rodar:  blender --background --python construcoes.py [-- --rapido]
# Saídas: casa.glb, predio.glb, as caixas de colisão em ../src/colisoes.json e as prévias casa.png / predio.png
#
# Medidas em metros, origem no centro da planta, chão em z=0. As paredes são segmentos de altura variável: os vãos
# (portas e brechas) vão até o chão, então dá para passar, e as partes caídas ficam baixas (dá para pular). A colisão do
# jogo é a mesma lista de segmentos. Tetos e entulho são só visuais: não bloqueiam nada.

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u  # noqa: E402
from blender_util import (RAPIDO, assar_e_exportar, foto, juntar, material_parede, material_simples, novo_objeto, preparar_foto,
                          registrar_colisoes, ruido)  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)

ESP = 0.30  # espessura das paredes
M_PAREDE = material_parede()
M_CONCRETO = material_simples("concreto", (0.12, 0.115, 0.105), 0.95, 0.0, 9, 0.5)
M_PISO = material_simples("piso", (0.07, 0.065, 0.058), 0.95, 0.0, 14, 0.5)
M_TIJOLO = material_simples("tijolo_solto", (0.11, 0.032, 0.022), 0.95, 0.0, 30, 0.5)
M_VIGA = material_simples("viga", (0.05, 0.026, 0.012), 0.8, 0.0, 16, 0.55)
M_FERRO = material_simples("ferro", (0.09, 0.05, 0.03), 0.7, 0.6, 24, 0.6)


def caixa(partes, nome, centro, dim, material, rot=(0, 0, 0), cortes=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dim[0], v.co.y * dim[1], v.co.z * dim[2]))
    if cortes:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cortes, use_grid_fill=True)
    m = Matrix.Translation(centro) @ Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    partes.append(o)
    return o


def segmento_parede(partes, caixas_col, rnd, nome, eixo, pos, a, b, h):
    """parede ao longo de X (eixo 'x', na linha y=pos) ou de Y (eixo 'y', na linha x=pos), de 'a' até 'b', com topo irregular"""
    comp = b - a
    cx = (a + b) / 2
    dim = (comp, ESP, h) if eixo == "x" else (ESP, comp, h)
    centro = (cx, pos, h / 2) if eixo == "x" else (pos, cx, h / 2)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dim[0], v.co.y * dim[1], v.co.z * dim[2]))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=max(3, min(9, int(comp / 0.7))), use_grid_fill=True)
    for v in bm.verts:
        if v.co.z > h / 2 - 0.02:  # topo: quebrado e desigual (mais nas paredes baixas, que desabaram)
            ao_longo = v.co.x if eixo == "x" else v.co.y
            falha = 0.55 if h < 2.2 else 0.35
            v.co.z -= falha * max(0.0, 0.5 + 0.5 * ruido((ao_longo * 0.9 + cx, pos * 0.5, 3.0), 1.1)) * (0.4 + 0.6 * rnd.random())
        # as pontas também ficam esfarelando
        for sinal in (-1, 1):
            if abs((v.co.x if eixo == "x" else v.co.y) - sinal * comp / 2) < 0.01 and rnd.random() < 0.5:
                if eixo == "x":
                    v.co.x -= sinal * rnd.uniform(0, 0.12)
                else:
                    v.co.y -= sinal * rnd.uniform(0, 0.12)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(centro), verts=bm.verts)
    o = novo_objeto(nome, bm)
    o.data.materials.append(M_PAREDE)
    partes.append(o)
    # colisão: o segmento inteiro (com a espessura), na altura h
    if eixo == "x":
        caixas_col.append((cx, pos, comp, ESP, h))
    else:
        caixas_col.append((pos, cx, ESP, comp, h))


def entulho(partes, rnd, n, area, material=None):
    """tijolos e pedaços de concreto soltos (só visual)"""
    for i in range(n):
        x = rnd.uniform(area[0], area[1])
        y = rnd.uniform(area[2], area[3])
        s = rnd.uniform(0.12, 0.38)
        caixa(partes, f"entulho_{i}", (x, y, s * 0.4), (s, s * rnd.uniform(0.6, 1.4), s * 0.8), material or (M_TIJOLO if rnd.random() < 0.6 else M_CONCRETO),
              rot=(rnd.uniform(-20, 20), rnd.uniform(-20, 20), rnd.uniform(0, 180)))


def construcao(nome, largura, profundidade, paredes, tetos, vigas, semente, entulhos):
    rnd = random.Random(semente)
    partes, col = [], []
    # piso
    caixa(partes, "piso", (0, 0, 0.02), (largura + 0.1, profundidade + 0.1, 0.05), M_PISO)
    for eixo, pos, segs in paredes:
        for i, (a, b, h) in enumerate(segs):
            segmento_parede(partes, col, rnd, f"parede_{eixo}{pos}_{i}", eixo, pos, a, b, h)
    for i, (centro, dim, rot) in enumerate(tetos):
        caixa(partes, f"teto_{i}", centro, dim, M_CONCRETO, rot=rot, cortes=2)
    for i, (centro, comp, rot) in enumerate(vigas):
        caixa(partes, f"viga_{i}", centro, (comp, 0.14, 0.18), M_VIGA, rot=rot)
        caixa(partes, f"vergalhao_{i}", (centro[0] + rnd.uniform(-0.3, 0.3), centro[1], centro[2] - 0.15), (0.03, 0.03, 0.9), M_FERRO,
              rot=(rnd.uniform(-25, 25), rnd.uniform(-25, 25), 0))
    for area, n in entulhos:
        entulho(partes, rnd, n, area)
    obj = juntar(partes, nome)
    registrar_colisoes(nome, col)
    assar_e_exportar(obj, nome, AQUI, angulo_uv=80, tam_bake=(1024 if RAPIDO else 2048), tam_export=1024)
    return obj


# ---- casa: 10 x 8, um andar ----
W, D = 10.0, 8.0
casa = construcao(
    "casa", W, D,
    paredes=[
        ("x", D / 2, [(-5.15, -2.0, 3.0), (-2.0, 0.8, 1.1), (0.8, 5.15, 2.5)]),                  # fundos: parte desabou no meio
        ("x", -D / 2, [(-5.15, -0.7, 3.0), (0.7, 2.6, 3.0), (2.6, 5.15, 1.3)]),                  # frente: porta e canto caído
        ("y", -W / 2, [(-4.15, -0.5, 3.0), (0.5, 4.15, 2.2)]),                                    # esquerda: porta lateral
        ("y", W / 2, [(-4.15, -1.8, 2.6), (1.8, 4.15, 3.0)]),                                     # direita: brecha de explosão
        ("y", 0.8, [(-4.0, -1.4, 2.8), (-0.4, 0.8, 2.8)]),                                        # divisória interna com passagem
    ],
    tetos=[((-2.3, -1.9, 3.1), (5.6, 4.2, 0.16), (4, -6, 0)), ((3.0, 2.5, 3.0), (4.4, 3.2, 0.16), (-5, 4, 6))],
    vigas=[((0.6, -0.5, 2.9), 4.2, (0, -8, 12)), ((-3.5, 1.2, 3.0), 3.4, (0, 5, -20)), ((3.4, -0.4, 2.7), 2.8, (0, 12, 30))],
    semente=3,
    entulhos=[((-1.8, 1.6, 3.8, 5.2), 14), ((3.2, 5.8, -1.4, 1.4), 12), ((-0.8, 2.8, -4.8, -3.2), 10)],
)

# ---- prédio: 14 x 10, dois andares (o de cima só em parte; só o térreo é acessível) ----
W2, D2 = 14.0, 10.0
predio = construcao(
    "predio", W2, D2,
    paredes=[
        ("x", D2 / 2, [(-7.15, -3.0, 6.2), (-3.0, 0.0, 3.2), (0.0, 3.5, 6.2), (3.5, 7.15, 4.4)]),
        ("x", -D2 / 2, [(-7.15, -2.5, 6.2), (-1.2, 3.0, 6.2), (4.4, 7.15, 5.0)]),                # frente: duas portas
        ("y", -W2 / 2, [(-5.15, -1.5, 6.2), (1.5, 5.15, 3.0)]),                                    # esquerda: brecha grande
        ("y", W2 / 2, [(-5.15, -0.5, 5.4), (2.5, 5.15, 5.4)]),                                     # direita: brecha de explosão
        ("y", -1.5, [(-5.0, -2.0, 3.2), (-1.0, 1.0, 3.2), (2.0, 5.0, 3.2)]),                      # divisórias internas com passagens
        ("x", 0.0, [(-7.0, -3.0, 3.0), (-1.8, -1.5, 3.0)]),
    ],
    tetos=[((-3.5, 0.0, 3.35), (6.2, 8.0, 0.2), (3, -4, 0)), ((3.0, -2.0, 6.3), (4.6, 4.0, 0.2), (-6, 5, 8)), ((4.0, 3.5, 3.3), (4.0, 3.0, 0.2), (5, 3, -7))],
    vigas=[((0.0, 1.0, 3.3), 5.0, (0, 6, 18)), ((-2.0, -3.0, 6.2), 4.0, (0, -10, -14)), ((5.0, 0.5, 5.5), 3.2, (0, 18, 80))],
    semente=8,
    entulhos=[((-3.0, 3.0, 4.6, 6.4), 16), ((6.4, 8.4, -1.5, 3.0), 18), ((-8.4, -6.0, 1.0, 4.5), 14), ((-1.0, 3.5, -1.0, 1.5), 10)],
)

# ---- prévias ----
preparar_foto(24)
predio.location = (14.0, 0, 0)
foto("casa", AQUI, (-8.0, -11.5, 6.0), (0, 0, 1.5), lente=34)
foto("predio", AQUI, (14 - 12.5, -17.0, 8.5), (14, 0, 2.5), lente=34)
print("pronto")
