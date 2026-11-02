# Fuzil "estelar": rifle de desenho animado azul, com coronha e mira amarelas, empunhadura laranja e detalhes ciano que brilham
# (feito a partir da imagem image_9ab78da5.jpg, sem as escritas). Um objeto só, vários materiais (Principled, o ciano é emissivo).
# Rodar:  blender --background --python fuzil_estelar.py [-- --rapido]
# Saídas: fuzil_estelar.glb (dois objetos: "fuzil_estelar" e "reddot", a mira) e as prévias fuzil_estelar_lado.png / fuzil_estelar_3q.png (na pasta modelos)
#
# Medidas em metros (comprimento total ~0,95 m). A origem é a MÃO que segura (a empunhadura) e o cano aponta para +Y no Blender
# (no jogo, para -Z, como em armas.py). Ponta do cano: y = 0,66 | fundo da coronha: y = -0,29 | o alto da mira fica em z = 0,35.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

AQUI = os.path.dirname(os.path.abspath(__file__))
RAPIDO = "--rapido" in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)

S = 0.95 / 1205  # metros por pixel da imagem de referência


def P(px, py):
    """pixel da imagem (x para a frente, y para baixo) -> (y, z) do Blender, com a empunhadura na origem"""
    return ((px - 470) * S, (520 - py) * S)


def srgb(hexa):
    c = [(hexa >> s & 255) / 255 for s in (16, 8, 0)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)


def material(nome, hexa, aspereza=0.5, metal=0.0, brilho=0.0):
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(hexa), 1)
    b.inputs["Roughness"].default_value = aspereza
    b.inputs["Metallic"].default_value = metal
    if brilho:
        b.inputs["Emission Color"].default_value = (*srgb(hexa), 1)
        b.inputs["Emission Strength"].default_value = brilho
    return m


AZUL = material("azul", 0x2A5EA8, 0.42, 0.05)
AZUL_ESC = material("azul_escuro", 0x183B78, 0.5, 0.05)
ACO_AZUL = material("aco_azulado", 0x6F93BD, 0.4, 0.25)
AMARELO = material("amarelo", 0xF0B323, 0.42, 0.0)
LARANJA = material("laranja", 0xD8782A, 0.55, 0.0)
CINZA = material("metal", 0x8B929C, 0.32, 0.8)
ESCURO = material("escuro", 0x14171E, 0.6, 0.1)
BRANCO = material("branco", 0xF2F2F2, 0.5, 0.0)
CIANO = material("ciano_brilho", 0x35E8FF, 0.25, 0.0, 6.0)

partes = []


def novo(nome, bm, mat, bisel):
    me = bpy.data.meshes.new(nome)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(nome, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    if bisel:
        m = o.modifiers.new("bisel", "BEVEL")
        m.width = bisel
        m.segments = 2
        m.limit_method = "ANGLE"
        m.angle_limit = math.radians(35)
    partes.append(o)
    return o


def prisma(nome, perfil_px, meia, mat, x=0.0, bisel=0.0022):
    """perfil lateral (pixels da imagem) extrudado em x, de x-meia a x+meia"""
    bm = bmesh.new()
    pts = [P(*p) for p in perfil_px]
    a = [bm.verts.new((x - meia, y, z)) for y, z in pts]
    b = [bm.verts.new((x + meia, y, z)) for y, z in pts]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    n = len(pts)
    for i in range(n):
        bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return novo(nome, bm, mat, bisel)


def caixa_px(nome, x0, y0, x1, y1, meia, mat, x=0.0, bisel=0.0022):
    return prisma(nome, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], meia, mat, x, bisel)


def cilindro_y(nome, px0, px1, pz, r, mat, x=0.0, seg=22, bisel=0.0015):
    """cilindro com o eixo ao longo do cano (y), de px0 a px1 (pixels), centro na altura pz (pixel)"""
    y0, z = P(px0, pz)
    y1, _ = P(px1, pz)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=abs(y1 - y0))
    for v in bm.verts:
        v.co = (v.co.x, v.co.z, v.co.y)  # eixo z -> y
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = novo(nome, bm, mat, bisel)
    o.location = (x, (y0 + y1) / 2, z)
    return o


def cilindro_x(nome, px, py, r, comprimento, mat, x, seg=14):
    """cilindro com o eixo na lateral (x): parafusos, botões"""
    y, z = P(px, py)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=comprimento)
    for v in bm.verts:
        v.co = (v.co.z, v.co.y, v.co.x)  # eixo z -> x
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = novo(nome, bm, mat, 0)
    o.location = (x, y, z)
    return o


def barra(nome, a_px, b_px, esp, mat, x=0.0):
    ya, za = P(*a_px)
    yb, zb = P(*b_px)
    comp = math.hypot(yb - ya, zb - za)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = (v.co.x * esp, v.co.y * comp, v.co.z * esp)
    o = novo(nome, bm, mat, 0.001)
    o.location = (x, (ya + yb) / 2, (za + zb) / 2)
    o.rotation_euler = (math.atan2(zb - za, yb - ya), 0, 0)
    return o


def lados(f):
    """chama f(lado) nos dois lados da arma (+1 e -1)"""
    for lado in (1, -1):
        f(lado)


def decal(nome, perfil_px, lado, superficie, mat):
    """placa fininha colada na lateral (a 'superficie' é a meia-largura da peça)"""
    return prisma(nome, perfil_px, 0.0008, mat, x=lado * (superficie + 0.0006), bisel=0)


def estrela(cx, cy, r):
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.42
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    return pts


# ---------------------------------------------------------------- coronha (amarela, com a chapa azul)
prisma("coronha", [(140, 360), (345, 312), (378, 335), (378, 425), (332, 442), (300, 470), (236, 556), (186, 572), (150, 562), (135, 430)], 0.026, AMARELO)
prisma("coronha_chapa", [(104, 360), (150, 352), (190, 568), (150, 574), (114, 525)], 0.0295, AZUL)
prisma("coronha_faixa", [(212, 338), (246, 328), (246, 428), (212, 436)], 0.0275, AZUL)
prisma("coronha_apoio", [(178, 440), (260, 430), (250, 470), (186, 482)], 0.0275, AMARELO)
cilindro_y("coronha_tubo", 368, 402, 382, 0.026, CINZA)
caixa_px("coronha_trava", 300, 470, 322, 488, 0.012, CINZA)

# ---------------------------------------------------------------- caixa da culatra (azul) e alça de transporte
prisma("culatra", [(398, 352), (470, 325), (700, 330), (738, 350), (738, 470), (562, 476), (470, 456), (398, 432)], 0.026, AZUL)
prisma("culatra_alta", [(455, 268), (790, 236), (802, 266), (802, 340), (455, 346)], 0.0245, ACO_AZUL)
prisma("alca_cima", [(470, 172), (715, 152), (786, 192), (786, 218), (715, 200), (492, 218)], 0.019, ACO_AZUL)
prisma("alca_tras", [(440, 268), (482, 192), (522, 198), (516, 268)], 0.019, ACO_AZUL)
prisma("alca_frente", [(742, 204), (790, 194), (802, 268), (746, 268)], 0.019, ACO_AZUL)
for i in range(7):
    caixa_px(f"trilho_{i}", 490 + i * 38, 150 - i * 2.4, 504 + i * 38, 170 - i * 2.4, 0.016, AZUL_ESC, bisel=0.001)

# ---------------------------------------------------------------- mira holográfica amarela
prisma("reddot", [(540, 150), (582, 92), (662, 88), (680, 132), (678, 182), (540, 188)], 0.0225, AMARELO)
cilindro_x("reddot_botao", 600, 150, 0.009, 0.016, CINZA, 0.0225)


def mira_lente(lado):
    decal("reddot_lente", [(615, 100), (655, 100), (655, 136), (615, 136)], lado, 0.0225, CIANO)


lados(mira_lente)

# ---------------------------------------------------------------- guarda-mão azul, tampa laranja, cano e supressor
prisma("guardamao", [(795, 218), (985, 182), (1026, 206), (1026, 336), (800, 364)], 0.028, AZUL)
prisma("guardamao_baixo", [(800, 352), (1024, 328), (1024, 346), (800, 374)], 0.0305, AZUL_ESC)
prisma("mira_frente", [(950, 186), (966, 128), (996, 124), (1002, 192)], 0.007, AZUL_ESC)
cilindro_y("tampa", 1004, 1044, 246, 0.052, LARANJA, seg=32)
cilindro_y("cano", 1040, 1196, 248, 0.0145, CINZA)
cilindro_y("cano_anel", 1058, 1078, 248, 0.019, CINZA)
cilindro_y("freio", 1180, 1312, 206, 0.027, AZUL_ESC, seg=22)
cilindro_y("freio_base", 1170, 1190, 206, 0.022, CINZA)
cilindro_y("freio_ponta", 1296, 1314, 206, 0.0295, AZUL, seg=22)

# faixas amarelas inclinadas na emenda da culatra com o guarda-mão
prisma("faixa_1", [(752, 226), (772, 221), (753, 362), (733, 365)], 0.0292, AMARELO, bisel=0.0012)
prisma("faixa_2", [(779, 221), (797, 217), (777, 358), (759, 361)], 0.0292, AMARELO, bisel=0.0012)


def detalhes_guardamao(lado):
    s = 0.028
    for i, (x0, x1) in enumerate([(822, 880), (904, 966)]):
        decal("fenda_cima", [(x0, 214 - i * 6), (x1, 207 - i * 6), (x1, 222 - i * 6), (x0, 229 - i * 6)], lado, s, ESCURO)
    for i in range(4):
        x0 = 824 + i * 42
        decal("fenda_baixo", [(x0, 312 - i * 4), (x0 + 22, 308 - i * 4), (x0 + 36, 336 - i * 4), (x0 + 14, 340 - i * 4)], lado, s, ESCURO)
    decal("brilho_1", [(818, 262), (882, 255), (886, 285), (822, 292)], lado, s, CIANO)
    decal("brilho_2", [(896, 252), (962, 246), (966, 276), (900, 282)], lado, s, CIANO)
    decal("estrela_1", estrela(694, 262, 11), lado, 0.0245, BRANCO)
    decal("estrela_2", estrela(792, 300, 11), lado, 0.0285, BRANCO)


lados(detalhes_guardamao)

# ---------------------------------------------------------------- empunhadura laranja, gatilho, abertura, carregador
prisma("empunhadura", [(468, 428), (522, 432), (528, 522), (502, 592), (446, 574), (426, 546), (452, 498)], 0.0175, LARANJA)
for i, (a, b) in enumerate([((525, 438), (528, 472)), ((528, 472), (552, 488)), ((552, 488), (585, 478)), ((585, 478), (598, 455)), ((598, 455), (600, 436))]):
    barra(f"guarda_mato_{i}", a, b, 0.007, CINZA)
barra("gatilho", (548, 446), (560, 480), 0.007, CINZA)
caixa_px("bocal_carregador", 560, 446, 722, 476, 0.022, ACO_AZUL)


def culatra_detalhes(lado):
    s = 0.026
    decal("abertura", [(578, 278), (672, 278), (672, 322), (578, 322)], lado, s, ESCURO)
    decal("janela_brilho", [(615, 366), (688, 366), (688, 412), (615, 412)], lado, s, CIANO)
    for k in range(3):
        d = k * 24
        decal("seta", [(426 + d, 325), (440 + d, 325), (462 + d, 342), (440 + d, 359), (426 + d, 359), (448 + d, 342)], lado, s, BRANCO)
    for px, py in [(452, 226), (448, 266), (772, 208)]:
        cilindro_x("parafuso", px, py, 0.0055, 0.004, CINZA, lado * 0.0192)
    cilindro_x("seletor", 490, 392, 0.009, 0.01, CINZA, lado * 0.0262)


lados(culatra_detalhes)
caixa_px("ferrolho", 586, 296, 668, 308, 0.0235, CINZA, bisel=0.001)

# carregador curvo (azul, com a fenda que brilha e a base cinza)
prisma("carregador", [(612, 468), (624, 535), (655, 598), (700, 650), (808, 584), (748, 583), (716, 520), (705, 452)], 0.0165, ACO_AZUL)
prisma("carregador_base", [(690, 640), (808, 568), (816, 586), (806, 602), (742, 668), (700, 664)], 0.0215, CINZA)


def carregador_detalhe(lado):
    decal("carregador_brilho", [(668, 496), (690, 490), (724, 566), (706, 580)], lado, 0.0165, CIANO)


lados(carregador_detalhe)

# ---------------------------------------------------------------- junta tudo (com os chanfros aplicados) e exporta
for o in partes:
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)
def juntar(lista, nome):
    bpy.ops.object.select_all(action="DESELECT")
    for o in lista:
        o.select_set(True)
    bpy.context.view_layer.objects.active = lista[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = nome
    obj.data.name = nome
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    except Exception:
        pass
    return obj


# a mira (reddot) sai como um objeto à parte: o jogo a esconde ao mirar e põe a câmera no lugar dela
partes_mira = [o for o in partes if o.name.startswith("reddot")]
partes_arma = [o for o in partes if not o.name.startswith("reddot")]
arma = juntar(partes_arma, "fuzil_estelar")
mira = juntar(partes_mira, "reddot")
bpy.ops.object.select_all(action="DESELECT")
arma.select_set(True)
mira.select_set(True)
bpy.context.view_layer.objects.active = arma
bpy.ops.export_scene.gltf(filepath=os.path.join(AQUI, "fuzil_estelar.glb"), export_format="GLB", use_selection=True, export_apply=True)
print("triângulos:", sum(len(p.vertices) - 2 for o in (arma, mira) for p in o.data.polygons))

# ---------------------------------------------------------------- prévia
c = bpy.context.scene
c.render.engine = "CYCLES"
c.cycles.samples = 24 if RAPIDO else 80
try:
    c.cycles.use_denoising = True
except Exception:
    pass
c.render.resolution_x = 1100 if RAPIDO else 1600
c.render.resolution_y = int(c.render.resolution_x * 0.55)
mundo = bpy.data.worlds.new("estudio")
mundo.use_nodes = True
fundo = mundo.node_tree.nodes["Background"]
fundo.inputs["Color"].default_value = (0.30, 0.32, 0.38, 1)
fundo.inputs["Strength"].default_value = 0.7
c.world = mundo
try:
    c.view_settings.view_transform = "Standard"
except Exception:
    pass


def luz(nome, loc, energia, tam):
    d = bpy.data.lights.new(nome, "AREA")
    d.energy = energia
    d.size = tam
    o = bpy.data.objects.new(nome, d)
    c.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector((0, 0.19, 0.0)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()


luz("principal", (1.4, -0.9, 1.2), 150, 1.4)
luz("contra", (-1.2, 1.0, 0.8), 70, 1.2)
luz("alto", (0.2, 0.2, 1.6), 50, 1.5)
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=3)
chao = bpy.data.meshes.new("chao")
bm.to_mesh(chao)
bm.free()
oc = bpy.data.objects.new("chao", chao)
c.collection.objects.link(oc)
oc.location = (0, 0.19, -0.36)
mc = bpy.data.materials.new("chao")
mc.use_nodes = True
mc.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.30, 0.31, 0.35, 1)
mc.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
chao.materials.append(mc)


def foto(nome, cam_loc, alvo, lente):
    cam = bpy.data.cameras.new(nome)
    cam.lens = lente
    co = bpy.data.objects.new(nome, cam)
    c.collection.objects.link(co)
    co.location = cam_loc
    co.rotation_euler = (Vector(alvo) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    c.camera = co
    c.render.filepath = os.path.join(AQUI, nome + ".png")
    bpy.ops.render.render(write_still=True)


foto("fuzil_estelar_lado", (1.75, 0.19, 0.13), (0, 0.19, 0.13), 50)
foto("fuzil_estelar_3q", (1.25, -0.8, 0.5), (0, 0.19, 0.1), 50)
print("pronto")
