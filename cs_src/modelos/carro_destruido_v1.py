# Carro destruído (low poly, sombreamento chapado) para o cenário do CS Caps.
# Rodar:  blender --background --python carro_destruido.py
# Saídas: carro_destruido.glb (para o jogo) e carro_destruido.png (prévia)
#
# Medidas em metros, carro de ~4,4 m de comprimento apontado para +X; o exportador troca para Y para cima (Three.js).

import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

AQUI = os.path.dirname(os.path.abspath(__file__))
rnd = random.Random(7)  # mesma amassada toda vez

# ---------- cena limpa ----------
bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene


def material(nome, cor, aspereza=0.9, metal=0.0):
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*cor, 1)
    b.inputs["Roughness"].default_value = aspereza
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*cor, 1)
    return m


FERRUGEM = material("lataria_queimada", (0.30, 0.09, 0.07), 0.85, 0.2)
TINTA = material("tinta_descascada", (0.46, 0.14, 0.10), 0.8, 0.2)
FUMACA = material("fuligem", (0.05, 0.045, 0.04), 0.95)
VIDRO = material("vidro_quebrado", (0.06, 0.09, 0.11), 0.2)
PNEU = material("pneu", (0.03, 0.03, 0.03), 0.95)
ARO = material("aro", (0.38, 0.36, 0.33), 0.5, 0.6)
CROMADO = material("para_choque", (0.55, 0.53, 0.5), 0.45, 0.7)
FERRO = material("ferro_exposto", (0.22, 0.12, 0.07), 0.7, 0.5)


def caixa(nome, centro, dim, mat, cortes=0):
    """caixa com 'cortes' subdivisões em cada direção (para poder amassar)"""
    bpy.ops.mesh.primitive_cube_add(size=1, location=centro)
    o = bpy.context.active_object
    o.name = nome
    o.scale = dim
    bpy.ops.object.transform_apply(scale=True)
    if cortes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cortes, use_grid_fill=True)
        bm.to_mesh(o.data)
        bm.free()
    o.data.materials.append(mat)
    return o


def amassar(o, pontos, raio, fundo, ruido=0.03):
    """empurra os vértices perto de cada ponto (em coordenadas locais) para dentro, como uma batida"""
    for p, direcao in pontos:
        p = Vector(p)
        d = Vector(direcao).normalized()
        for v in o.data.vertices:
            dist = (v.co - p).length
            if dist < raio:
                f = (1 - dist / raio) ** 1.5
                v.co += d * fundo * f + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * ruido * f
    o.data.update()


def desordem(o, quantia):
    for v in o.data.vertices:
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * quantia
    o.data.update()


def roda(nome, centro, raio=0.34, largura=0.24, tombo=0.0, murcho=1.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=raio, depth=largura, location=centro)
    p = bpy.context.active_object
    p.name = nome + "_pneu"
    p.rotation_euler = (math.radians(90 + tombo), 0, 0)
    p.scale = (1, murcho, 1)  # pneu murcho: achatado na vertical
    p.data.materials.append(PNEU)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=raio * 0.58, depth=largura * 1.08, location=centro)
    a = bpy.context.active_object
    a.name = nome + "_aro"
    a.rotation_euler = p.rotation_euler
    a.data.materials.append(ARO)
    return [p, a]


pecas = []

# ---------- carroceria ----------
base = caixa("chassi", (0, 0, 0.52), (4.4, 1.8, 0.5), FERRUGEM, cortes=3)
amassar(base, [((1.9, 0.9, 0.2), (-1, -0.6, 0)), ((-1.7, -0.9, 0.1), (0.5, 1, 0)), ((0.2, -0.9, 0.2), (0, 1, 0.1))], 1.0, 0.24)  # batidas na frente e na traseira
desordem(base, 0.012)
pecas.append(base)

cabine = caixa("cabine", (-0.25, 0, 1.06), (2.2, 1.62, 0.62), TINTA, cortes=3)
# teto afundado no meio (capotou/foi esmagado)
amassar(cabine, [((-0.1, 0.05, 0.31), (0, 0, -1))], 1.25, 0.28, 0.02)
amassar(cabine, [((0.9, -0.8, 0.2), (-0.6, 0.8, -0.2))], 0.7, 0.12)
desordem(cabine, 0.015)
pecas.append(cabine)

# vidros: placas escuras um pouco para dentro das laterais, com "buracos" (pedaços faltando)
for nome, centro, dim in [
    ("parabrisa", (0.86, 0, 1.12), (0.06, 1.35, 0.42)),
    ("vidro_traseiro", (-1.37, 0, 1.1), (0.06, 1.3, 0.38)),
    ("vidro_lado_e", (-0.25, 0.83, 1.12), (1.5, 0.05, 0.36)),
]:
    v = caixa(nome, centro, dim, VIDRO)
    pecas.append(v)
# o vidro do outro lado se foi: sobra o vão escuro da porta
vao = caixa("vao_lado_d", (-0.25, -0.81, 1.12), (1.5, 0.05, 0.38), FUMACA)
pecas.append(vao)

# capô levantado pela batida (articulado na ponta de trás)
capo = caixa("capo", (1.55, 0, 0.88), (1.3, 1.7, 0.1), TINTA, cortes=3)
capo.rotation_euler = (0, math.radians(-14), math.radians(2))
amassar(capo, [((0.3, 0.2, 0.05), (0, 0, -1))], 0.55, 0.12)
desordem(capo, 0.015)
pecas.append(capo)
# mancha de queimado sobre o capô (mesma inclinação, um pouco acima)
queimado = caixa("capo_queimado", (1.62, 0.1, 0.88 + 0.07), (0.95, 1.1, 0.02), FUMACA, cortes=2)
queimado.rotation_euler = capo.rotation_euler
queimado.location = capo.location + capo.rotation_euler.to_matrix() @ Vector((0.05, 0.1, 0.065))
desordem(queimado, 0.02)
pecas.append(queimado)

# motor queimado aparecendo sob o capô
motor = caixa("motor", (1.5, 0, 0.7), (0.9, 0.9, 0.35), FUMACA, cortes=1)
desordem(motor, 0.04)
pecas.append(motor)
for i in range(3):
    c = caixa(f"cano_{i}", (1.45 + i * 0.12, rnd.uniform(-0.3, 0.3), 0.95), (0.05, 0.05, 0.4), FERRO)
    c.rotation_euler = (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.5, 0.5), 0)
    pecas.append(c)

# porta do lado direito caída/pendurada
porta = caixa("porta_solta", (-0.2, -1.22, 0.62), (1.15, 0.08, 0.7), TINTA, cortes=2)
porta.rotation_euler = (math.radians(-62), 0, math.radians(3))
amassar(porta, [((0.2, 0, 0), (0, 1, 0))], 0.4, 0.07)
pecas.append(porta)

# porta-malas aberto torto
mala = caixa("tampa_mala", (-1.98, 0.04, 0.9), (0.9, 1.6, 0.08), FERRUGEM, cortes=2)
mala.rotation_euler = (0, math.radians(13), math.radians(-3))
desordem(mala, 0.012)
pecas.append(mala)

# para-choques: o da frente torto, o de trás caído
pf = caixa("para_choque_frente", (2.28, 0.05, 0.34), (0.16, 1.7, 0.18), CROMADO, cortes=2)
pf.rotation_euler = (0, math.radians(8), math.radians(7))
pecas.append(pf)
pt = caixa("para_choque_tras", (-2.3, -0.1, 0.22), (0.16, 1.6, 0.18), CROMADO)
pt.rotation_euler = (0, math.radians(-12), math.radians(-6))
pecas.append(pt)

# faróis estourados
for lado in (-1, 1):
    f = caixa(f"farol_{lado}", (2.2, lado * 0.62, 0.62), (0.1, 0.3, 0.18), FUMACA if lado < 0 else VIDRO)
    pecas.append(f)

# ---------- rodas: três no lugar, a traseira esquerda sumiu ----------
for nome, centro, tombo in [
    ("roda_fe", (1.38, 0.9, 0.34), 0),
    ("roda_fd", (1.38, -0.9, 0.27), 12),
    ("roda_td", (-1.38, -0.9, 0.3), -6),
]:
    pecas += roda(nome, centro, tombo=tombo, murcho=0.62 if nome == "roda_fd" else 1.0)
eixo = caixa("eixo_exposto", (-1.38, 0.78, 0.36), (0.1, 0.4, 0.1), FERRO)
pecas.append(eixo)
# a ponta sem roda encosta no chão
base.location.z -= 0.0

# ---------- chão de sujeira só para a prévia (não vai no .glb) ----------
bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
chao = bpy.context.active_object
chao.name = "_chao_previa"
chao.data.materials.append(material("terra", (0.16, 0.15, 0.14), 1.0))

# ---------- reúne tudo num objeto raiz e inclina (apoiado no canto sem roda) ----------
bpy.ops.object.empty_add(location=(0, 0, 0))
raiz = bpy.context.active_object
raiz.name = "carro_destruido"
for p in pecas:
    p.parent = raiz
raiz.rotation_euler = (math.radians(4.5), math.radians(-2), math.radians(0))
raiz.location.z = 0.08

# ---------- exporta (sem o chão) ----------
bpy.ops.object.select_all(action="DESELECT")
raiz.select_set(True)
for p in pecas:
    p.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(AQUI, "carro_destruido.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
)

# ---------- prévia ----------
mundo = bpy.data.worlds.new("m")
mundo.use_nodes = True
mundo.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.04, 0.06, 1)
cena.world = mundo
sol = bpy.data.lights.new("sol", "SUN")
sol.energy = 3.2
so = bpy.data.objects.new("sol", sol)
so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
cena.collection.objects.link(so)
cam = bpy.data.cameras.new("cam")
co = bpy.data.objects.new("cam", cam)
cena.collection.objects.link(co)
co.location = (5.2, -5.6, 2.6)
direcao = Vector((0, 0, 0.7)) - co.location
co.rotation_euler = direcao.to_track_quat("-Z", "Y").to_euler()
cena.camera = co
cena.render.engine = "CYCLES"
cena.cycles.samples = 40
cena.cycles.device = "CPU"
cena.render.resolution_x = 1100
cena.render.resolution_y = 640
cena.render.filepath = os.path.join(AQUI, "carro_destruido.png")
bpy.ops.render.render(write_still=True)
print("pronto")
