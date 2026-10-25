# Objetos de cobertura do cenário do CS Caps: barris, pneus, sacos de areia, barreira de concreto, caixotes e contêineres.
# Rodar:  blender --background --python cenario.py [-- --rapido]
# Saídas: um .glb por objeto, as caixas de colisão em ../src/colisoes.json e a prévia cenario.png
#
# Medidas em metros, origem no centro da base, chão em z=0 (o Blender usa Y para a profundidade; o jogo usa -Z).

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u  # noqa: E402
from blender_util import (RAPIDO, assar_e_exportar, cilindro_malha, colocar, foto, juntar, ligar, material_simples, mistura, no,
                          novo_material, novo_objeto, pneu, preparar_foto, rampa, registrar_colisoes, ruido, aro)  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
rnd = random.Random(21)


def caixa(partes, nome, centro, dim, material, rot=(0, 0, 0), bisel=0.0, cortes=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dim[0], v.co.y * dim[1], v.co.z * dim[2]))
    if cortes:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cortes, use_grid_fill=True)
    if bisel:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], offset=bisel, segments=2, profile=0.7, affect="EDGES")
    m = Matrix.Translation(centro) @ Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    partes.append(o)
    return o


def cilindro(partes, nome, centro, raio, altura, material, rot=(0, 0, 0), seg=16, raio2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=raio, radius2=raio if raio2 is None else raio2, depth=altura)
    m = Matrix.Translation(centro) @ Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    partes.append(o)
    return o


def finalizar(nome, partes, colisoes, tam_bake, angulo=75):
    obj = juntar(partes, nome)
    registrar_colisoes(nome, colisoes)
    assar_e_exportar(obj, nome, AQUI, angulo_uv=angulo, tam_bake=(tam_bake // 2 if RAPIDO else tam_bake), tam_export=min(tam_bake, 1024))
    return obj


def material_madeira(nome, claro, escuro):
    m = novo_material(nome)
    nt = m.node_tree
    bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    coord = no(m, "ShaderNodeTexCoord")
    onda = no(m, "ShaderNodeTexWave", wave_type="BANDS")
    onda.inputs["Scale"].default_value = 7
    onda.inputs["Distortion"].default_value = 6
    onda.inputs["Detail"].default_value = 3
    ligar(m, coord, "Object", onda, "Vector")
    r = rampa(m, (onda, "Fac"), [(0.2, (*escuro, 1)), (0.8, (*claro, 1))])
    ao = no(m, "ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.3
    mult = no(m, "ShaderNodeMix", data_type="RGBA")
    mult.blend_type = "MULTIPLY"
    mult.inputs["Factor"].default_value = 1.0
    ligar(m, r, "Color", mult, "A")
    ligar(m, ao, "Color", mult, "B")
    ligar(m, mult, "Result", bsdf, "Base Color")
    bsdf.inputs["Roughness"].default_value = 0.9
    return m


M_FERRUGEM_A = material_simples("barril_vermelho", (0.10, 0.025, 0.018), 0.7, 0.5, 10, 0.55)
M_FERRUGEM_B = material_simples("barril_azul", (0.025, 0.05, 0.10), 0.7, 0.5, 10, 0.55)
M_FERRUGEM_C = material_simples("barril_verde", (0.03, 0.07, 0.035), 0.7, 0.5, 10, 0.55)
M_METAL = material_simples("metal_velho", (0.07, 0.06, 0.05), 0.6, 0.7, 20, 0.5)
M_BORRACHA = material_simples("borracha", (0.016, 0.015, 0.014), 0.95, 0.0, 28, 0.4)
M_ARO = material_simples("aro_pneu", (0.06, 0.045, 0.03), 0.6, 0.6, 18, 0.6)
M_SACO = material_simples("saco", (0.13, 0.105, 0.065), 0.98, 0.0, 26, 0.45)
M_CONCRETO = material_simples("concreto", (0.14, 0.135, 0.125), 0.95, 0.0, 8, 0.55)
M_FERRO = material_simples("vergalhao", (0.09, 0.05, 0.03), 0.7, 0.6, 24, 0.6)
M_MADEIRA = material_madeira("madeira", (0.13, 0.075, 0.035), (0.06, 0.032, 0.014))
M_MADEIRA_ESC = material_madeira("madeira_velha", (0.08, 0.05, 0.026), (0.035, 0.02, 0.01))

objetos = []

# ---------------------------------------------------------------- barris ----
partes = []
for i, (x, y, mat) in enumerate([(-0.4, -0.3, M_FERRUGEM_A), (0.42, -0.25, M_FERRUGEM_B), (0.0, 0.45, M_FERRUGEM_C)]):
    cilindro(partes, f"barril_{i}", (x, y, 0.45), 0.29, 0.9, mat, seg=14)
    for k, zb in enumerate((0.20, 0.45, 0.70)):
        cilindro(partes, f"cinta_{i}_{k}", (x, y, zb), 0.305, 0.05, M_METAL, seg=14)
    cilindro(partes, f"tampa_{i}", (x, y, 0.905), 0.255, 0.03, M_METAL, seg=14)
# um barril deitado e outro tombado
cilindro(partes, "barril_deitado", (0.50, 0.65, 0.29), 0.29, 0.9, M_FERRUGEM_A, rot=(90, 0, 35), seg=14)
for k, off in enumerate((-0.22, 0.0, 0.22)):
    c = Vector((0.50, 0.65, 0.29)) + Vector((math.sin(math.radians(35)) * off * -1, math.cos(math.radians(35)) * off, 0))
    cilindro(partes, f"cinta_d{k}", tuple(c), 0.305, 0.05, M_METAL, rot=(90, 0, 35), seg=14)
objetos.append(finalizar("barris", partes, [(0.0, 0.1, 1.9, 1.85, 0.95)], 512))

# ---------------------------------------------------------------- pneus empilhados ----
partes = []
for i in range(4):
    p = pneu(f"pneu_{i}", M_BORRACHA, 1.35, 1.7, passos=22, ranhuras=14)
    colocar(p, (rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), 0.14 + i * 0.285), (90, 0, rnd.uniform(0, 90)))
    partes.append(p)
a = aro("aro_topo", M_ARO, 1.35, 1.7, 14)
colocar(a, (0, 0, 0.14 + 3 * 0.285), (90, 0, 0))
partes.append(a)
# dois pneus encostados na pilha
for i, (x, y, rot) in enumerate([(0.70, -0.35, (72, 0, 20)), (-0.55, 0.55, (96, 8, -40))]):
    p = pneu(f"pneu_lado_{i}", M_BORRACHA, 1.35, 1.7, passos=22, ranhuras=14)
    colocar(p, (x, y, 0.40), rot)
    partes.append(p)
objetos.append(finalizar("pneus", partes, [(0.05, 0.0, 1.9, 1.5, 1.15)], 512))

# ---------------------------------------------------------------- sacos de areia (muro de 3,2 m) ----
partes = []
fileiras = 5
for r in range(fileiras):
    n = 6 if r % 2 == 0 else 5
    x0 = -1.5 if r % 2 == 0 else -1.25
    for k in range(n):
        caixa(partes, f"saco_{r}_{k}", (x0 + k * 0.52 + rnd.uniform(-0.02, 0.02), rnd.uniform(-0.04, 0.04), 0.11 + r * 0.205),
              (0.50, 0.34 - r * 0.012, 0.21), M_SACO, rot=(rnd.uniform(-3, 3), rnd.uniform(-3, 3), rnd.uniform(-4, 4)), bisel=0.055)
objetos.append(finalizar("sacos", partes, [(0.0, 0.0, 3.2, 0.9, 1.1)], 512))

# ---------------------------------------------------------------- barreira de concreto ----
bm = bmesh.new()
perfil = [(-0.30, 0.0), (0.30, 0.0), (0.27, 0.18), (0.17, 0.50), (0.12, 1.10), (-0.12, 1.10), (-0.17, 0.50), (-0.27, 0.18)]
comp = 3.0
for lado in (-1, 1):
    pass
vs0 = [bm.verts.new((x, -comp / 2, z)) for x, z in perfil]
vs1 = [bm.verts.new((x, comp / 2, z)) for x, z in perfil]
n = len(perfil)
for j in range(n):
    bm.faces.new((vs0[j], vs0[(j + 1) % n], vs1[(j + 1) % n], vs1[j]))
bm.faces.new(vs0[::-1])
bm.faces.new(vs1)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=6, use_grid_fill=True)
for v in bm.verts:  # pedaços quebrados e desgaste
    v.co += Vector((0.02 * ruido(v.co, 3.0), 0.03 * ruido((v.co.z, v.co.x, v.co.y), 2.5), 0.02 * ruido((v.co.y, v.co.z, v.co.x), 3.0)))
    if v.co.y > comp / 2 - 0.5 and v.co.z > 0.8:
        v.co.z -= 0.25 * max(0, ruido(v.co, 4.0) + 0.3)
    if v.co.y < -comp / 2 + 0.2 and v.co.z > 0.7:
        v.co.y += 0.10
partes = [novo_objeto("barreira_corpo", bm)]
partes[0].data.materials.append(M_CONCRETO)
for i, (x, z) in enumerate([(-0.04, 1.12), (0.05, 1.1)]):
    caixa(partes, f"vergalhao_{i}", (x, comp / 2 - 0.15 + 0.08, z + 0.1), (0.025, 0.025, 0.5), M_FERRO, rot=(rnd.uniform(-35, 35), rnd.uniform(-20, 20), 0))
objetos.append(finalizar("barreira", partes, [(0.0, 0.0, 0.7, 3.0, 1.1)], 512))

# ---------------------------------------------------------------- caixotes (pilha) + palete ----
partes = []
for i in range(3):
    caixa(partes, f"palete_{i}", (-0.5 + i * 0.0, 0.0, 0.07), (1.9, 0.12, 0.12), M_MADEIRA_ESC, bisel=0.01)
    partes[-1].location.y = -0.4 + i * 0.4
for i, (x, y, z, rot, s) in enumerate([(-0.5, 0.0, 0.64, 2, 1.0), (0.52, 0.02, 0.64, -3, 1.0), (0.0, 0.0, 1.66, 4, 1.0)]):
    caixa(partes, f"caixote_{i}", (x, y, z), (s, s, s), M_MADEIRA, rot=(0, 0, rot), bisel=0.025)
    for k in range(2):  # ripas cruzadas nas faces
        caixa(partes, f"ripa_{i}_{k}", (x, y - s / 2 - 0.008, z), (0.10, 0.02, s * 1.35), M_MADEIRA_ESC, rot=(0, 45 * (1 if k == 0 else -1), rot))
objetos.append(finalizar("caixotes", partes, [(0.0, 0.0, 2.1, 1.1, 2.15)], 512))

# ---------------------------------------------------------------- contêineres (duas cores) ----
def container(nome, cor, semente):
    r = random.Random(semente)
    mat = material_simples(nome + "_lata", cor, 0.75, 0.5, 6, 0.6)
    partes = []
    caixa(partes, "casco", (0, 0, 1.28), (6.0, 2.35, 2.5), mat, bisel=0.02)
    # chapas onduladas nas laterais
    for lado in (-1, 1):
        for k in range(-14, 15):
            caixa(partes, f"onda_{lado}_{k}", (k * 0.2, lado * 1.19, 1.28), (0.09, 0.05, 2.34), mat)
    # cantoneiras e portas no fundo
    for sx in (-1, 1):
        for sy in (-1, 1):
            caixa(partes, "quina", (sx * 2.95, sy * 1.12, 1.28), (0.14, 0.14, 2.56), M_METAL)
    caixa(partes, "porta_e", (3.02, -0.58, 1.28), (0.05, 1.1, 2.3), mat)
    porta = caixa(partes, "porta_d_aberta", (3.35, 1.45, 1.28), (0.05, 1.1, 2.3), mat, rot=(0, 0, 70 + r.uniform(-8, 8)))
    for k in range(4):
        caixa(partes, f"trava_{k}", (3.07, -0.30 - (k % 2) * 0.55, 1.28), (0.04, 0.03, 2.2), M_METAL)
    caixa(partes, "ferrugem_base", (0, 0, 0.13), (6.05, 2.4, 0.26), M_METAL)
    # amassado e rasgo: um pedaço da lateral entortado
    caixa(partes, "chapa_solta", (-1.2, -1.25, 1.2), (1.1, 0.04, 0.9), mat, rot=(14, 0, 0))
    return finalizar(nome, partes, [(0.0, 0.0, 6.1, 2.45, 2.6)], 1024)


objetos.append(container("container_a", (0.12, 0.030, 0.020), 5))   # vermelho enferrujado
objetos.append(container("container_b", (0.028, 0.055, 0.115), 9))  # azul desbotado

# ---------------------------------------------------------------- prévia: todos em fila ----
x = -9.0
for o in objetos:
    o.location = (x, 0, 0)
    x += 3.4 if not o.name.startswith("container") else 7.0
preparar_foto(18)
foto("cenario", AQUI, (3.0, -13.0, 5.5), (3.5, 0, 0.9), lente=40)
print("pronto")
