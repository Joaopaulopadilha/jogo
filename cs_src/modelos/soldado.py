# Soldado low poly (~1,8 m, com esqueleto e animações "parado", "correr", "agachado" e "agachado_andar") para o CS Caps.
# Rodar:  blender --background --python soldado.py [-- --rapido]
# Saídas: soldado.glb (jogo) e soldado.png / soldado_2.png / soldado_3.png (prévias)
#
# Medidas em metros; no Blender o soldado olha para +Y (no jogo, o exportador o deixa olhando para -Z, como a câmera).
# O colete e a faixa do capacete usam o material "equipe" (branco): o jogo pinta com a cor de cada jogador.
# Os ossos (quadril, tronco, perna_*, canela_*, pe_*) são rígidos: cada peça pertence 100% a um osso.
# A perna tem joelho (canela) e tornozelo (pe) para o agachar: no jogo o quadril desce 0,44 m (ALTURA_AGACHADO).

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u  # noqa: E402
from blender_util import RAPIDO, ativar, foto, material_simples, novo_material, novo_objeto, preparar_foto  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------------------------------------------------------------- materiais (assados numa textura) ----
M_UNIFORME = material_simples("uniforme", (0.05, 0.062, 0.034), 0.9, 0.0, 22, 0.5)
M_MOCHILA = material_simples("mochila", (0.035, 0.04, 0.025), 0.9, 0.0, 16, 0.5)
M_CAPACETE = material_simples("capacete", (0.06, 0.07, 0.04), 0.7, 0.2, 14, 0.45)
M_PELE = material_simples("pele", (0.30, 0.17, 0.11), 0.8, 0.0, 30, 0.2)
M_PRETO = material_simples("equipamento", (0.018, 0.018, 0.02), 0.8, 0.0, 22, 0.4)
M_METAL = material_simples("metal", (0.10, 0.10, 0.11), 0.4, 0.8, 20, 0.4)
M_EQUIPE = novo_material("equipe")  # branco liso: o jogo pinta
_b = [n for n in M_EQUIPE.node_tree.nodes if n.type == "BSDF_PRINCIPLED"][0]
_b.inputs["Base Color"].default_value = (1, 1, 1, 1)
_b.inputs["Roughness"].default_value = 0.75

pecas = []  # (objeto, osso)


def adicionar(o, osso, material):
    o.data.materials.append(material)
    pecas.append((o, osso))
    return o


def malha_de(nome, bm):
    return novo_objeto(nome, bm)


def caixa(nome, centro, dim, osso, material, bisel=0.02, rot=(0, 0, 0), suave_nivel=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dim[0], v.co.y * dim[1], v.co.z * dim[2]))
    if bisel:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], offset=bisel * 2.4, segments=3, profile=0.7, affect="EDGES")
    m = Matrix.Translation(centro) @ Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    o = adicionar(malha_de(nome, bm), osso, material)
    if suave_nivel:
        ativar(o)
        mod = o.modifiers.new("suave", "SUBSURF")
        mod.levels = suave_nivel
        mod.render_levels = suave_nivel
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return o


def esfera(nome, centro, raios, osso, material, seg=12, aneis=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=aneis, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * raios[0], v.co.y * raios[1], v.co.z * raios[2])) + Vector(centro)
    return adicionar(malha_de(nome, bm), osso, material)


def segmento(nome, a, b, r1, r2, osso, material, seg=9):
    """cilindro afinando de 'a' (raio r1) até 'b' (raio r2)"""
    a, b = Vector(a), Vector(b)
    comp = (b - a).length
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=comp)
    # o cone nasce com a base em -Z; leva o eixo Z até a direção a->b
    q = Vector((0, 0, 1)).rotation_difference(b - a)
    m = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return adicionar(malha_de(nome, bm), osso, material)


# ---------------------------------------------------------------- modelagem ----
def perna(lado):
    x = 0.115 * lado
    n = "d" if lado > 0 else "e"
    segmento(f"coxa_{n}", (x, 0.0, 0.97), (x, 0.03, 0.55), 0.100, 0.078, f"perna_{n}", M_UNIFORME)
    # o joelho (esfera) preenche a junta quando a perna dobra
    esfera(f"joelho_{n}", (x, 0.03, 0.55), (0.079, 0.079, 0.079), f"canela_{n}", M_UNIFORME)
    caixa(f"joelheira_{n}", (x, 0.085, 0.56), (0.15, 0.07, 0.13), f"canela_{n}", M_PRETO, 0.02)
    segmento(f"canela_{n}", (x, 0.03, 0.55), (x, -0.01, 0.15), 0.074, 0.056, f"canela_{n}", M_UNIFORME)
    caixa(f"cano_bota_{n}", (x, -0.005, 0.21), (0.13, 0.13, 0.14), f"canela_{n}", M_PRETO, 0.03)
    caixa(f"bota_{n}", (x, 0.045, 0.08), (0.16, 0.31, 0.16), f"pe_{n}", M_PRETO, 0.035)


perna(1)
perna(-1)

# quadril e cinto
caixa("quadril", (0, 0, 0.99), (0.38, 0.22, 0.17), "quadril", M_UNIFORME, 0.04)
caixa("cinto", (0, 0, 1.07), (0.40, 0.24, 0.06), "quadril", M_PRETO, 0.015)
caixa("coldre", (0.23, 0.0, 0.94), (0.08, 0.13, 0.17), "quadril", M_PRETO, 0.02)
caixa("bolsa_cinto", (-0.16, 0.12, 1.02), (0.12, 0.07, 0.10), "quadril", M_PRETO, 0.02)

# tronco, colete (cor da equipe), mochila
caixa("peito", (0, 0, 1.30), (0.40, 0.22, 0.46), "tronco", M_UNIFORME, 0.05)
caixa("colete", (0, 0.015, 1.30), (0.45, 0.27, 0.36), "tronco", M_EQUIPE, 0.05)
for i, (bx, bz) in enumerate([(-0.10, 1.20), (0.10, 1.20)]):
    caixa(f"carregador_{i}", (bx, 0.155, bz), (0.11, 0.05, 0.13), "tronco", M_PRETO, 0.015)
caixa("placa_peito", (0, 0.145, 1.38), (0.22, 0.03, 0.14), "tronco", M_METAL, 0.01)
caixa("mochila", (0, -0.21, 1.31), (0.32, 0.17, 0.42), "tronco", M_MOCHILA, 0.04)
caixa("rolo_mochila", (0, -0.22, 1.56), (0.30, 0.12, 0.10), "tronco", M_MOCHILA, 0.04)
for lado in (-1, 1):
    esfera(f"ombro_{lado}", (0.265 * lado, 0.0, 1.47), (0.085, 0.085, 0.085), "tronco", M_UNIFORME)

# pescoço, cabeça, balaclava, óculos, capacete
segmento("pescoco", (0, 0, 1.50), (0, 0, 1.60), 0.062, 0.058, "tronco", M_PELE)
esfera("cabeca", (0, 0.012, 1.67), (0.108, 0.125, 0.13), "tronco", M_PELE, 14, 10)
esfera("balaclava", (0, 0.02, 1.625), (0.113, 0.128, 0.078), "tronco", M_PRETO, 14, 8)
caixa("oculos", (0, 0.115, 1.685), (0.20, 0.05, 0.065), "tronco", M_METAL, 0.015)
esfera("capacete", (0, -0.005, 1.725), (0.142, 0.160, 0.118), "tronco", M_CAPACETE, 14, 8)
caixa("faixa_capacete", (0, -0.005, 1.835), (0.045, 0.27, 0.02), "tronco", M_EQUIPE, 0.005)
caixa("aba_capacete", (0, 0.12, 1.755), (0.20, 0.06, 0.025), "tronco", M_CAPACETE, 0.01)

# braços segurando o fuzil (a arma do jogo fica na mão direita, ver "pontos de mão" abaixo)
MAO_D = Vector((0.14, 0.24, 1.16))
MAO_E = Vector((0.12, 0.52, 1.19))
OMBRO_D, OMBRO_E = Vector((0.27, 0.0, 1.46)), Vector((-0.27, 0.0, 1.46))
COTOVELO_D, COTOVELO_E = Vector((0.31, 0.02, 1.27)), Vector((-0.17, 0.26, 1.31))
for n, om, co, mao in [("d", OMBRO_D, COTOVELO_D, MAO_D), ("e", OMBRO_E, COTOVELO_E, MAO_E)]:
    segmento(f"braco_{n}", om, co, 0.066, 0.054, "tronco", M_UNIFORME)
    segmento(f"antebraco_{n}", co, mao, 0.054, 0.045, "tronco", M_UNIFORME)
    esfera(f"luva_{n}", mao, (0.055, 0.06, 0.055), "tronco", M_PRETO, 10, 6)

# ---------------------------------------------------------------- junta e atribui os ossos (peso 1 por peça) ----
for o, osso in pecas:
    vg = o.vertex_groups.new(name=osso)
    vg.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
    # (nada de sombreamento liso aqui: o objeto final decide)

objs = [o for o, _ in pecas]
ativar(objs[0])
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
soldado = bpy.context.active_object
soldado.name = "soldado"
bpy.ops.object.shade_smooth()
try:
    bpy.ops.object.shade_auto_smooth(angle=math.radians(50))
except Exception:
    pass

# ---------------------------------------------------------------- textura: desdobra e assa tudo menos a cor da equipe ----
ativar(soldado)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(75), island_margin=0.006, scale_to_bounds=False)
bpy.ops.object.mode_set(mode="OBJECT")

cena = bpy.context.scene
tam = 512 if RAPIDO else 1024
img = bpy.data.images.new("textura_soldado", tam, tam)
for m in soldado.data.materials:
    tex = m.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    m.node_tree.nodes.active = tex
cena.render.engine = "CYCLES"
cena.cycles.device = "CPU"
cena.cycles.samples = 16 if RAPIDO else 64
cena.render.bake.use_pass_direct = False
cena.render.bake.use_pass_indirect = False
cena.render.bake.use_pass_color = True
cena.render.bake.margin = 8
ativar(soldado)
bpy.ops.object.bake(type="DIFFUSE")
img.update()
import tempfile  # noqa: E402
tmp = os.path.join(tempfile.gettempdir(), "_textura_soldado.png")
img.filepath_raw = tmp
img.file_format = "PNG"
img.save()

# dois materiais finais: "soldado" (textura) e "equipe" (branco, pintado pelo jogo)
idx_equipe = [i for i, m in enumerate(soldado.data.materials) if m.name == "equipe"][0]
eh_equipe = [p.material_index == idx_equipe for p in soldado.data.polygons]
final = bpy.data.materials.new("soldado")
final.use_nodes = True
bsdf = [n for n in final.node_tree.nodes if n.type == "BSDF_PRINCIPLED"][0]
tx = final.node_tree.nodes.new("ShaderNodeTexImage")
tx.image = img.copy()
tx.image.scale(512, 512)
tx.image.pack()
final.node_tree.links.new(tx.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.85
bsdf.inputs["Metallic"].default_value = 0.0
M_EQUIPE.name = "equipe_provisorio"  # libera o nome "equipe" para o material final
equipe = bpy.data.materials.new("equipe")
equipe.use_nodes = True
eb = [n for n in equipe.node_tree.nodes if n.type == "BSDF_PRINCIPLED"][0]
eb.inputs["Base Color"].default_value = (1, 1, 1, 1)
eb.inputs["Roughness"].default_value = 0.75
eb.inputs["Metallic"].default_value = 0.0
soldado.data.materials.clear()
soldado.data.materials.append(final)
soldado.data.materials.append(equipe)
for p, eq in zip(soldado.data.polygons, eh_equipe):
    p.material_index = 1 if eq else 0

# ---------------------------------------------------------------- esqueleto e animações ----
bpy.ops.object.armature_add(location=(0, 0, 0))
arm = bpy.context.active_object
arm.name = "esqueleto"
bpy.ops.object.mode_set(mode="EDIT")
ebs = arm.data.edit_bones
ebs.remove(ebs[0])


def osso(nome, cabeca, cauda, pai=None):
    b = ebs.new(nome)
    b.head, b.tail = Vector(cabeca), Vector(cauda)
    if pai:
        b.parent = ebs[pai]
    return b


osso("quadril", (0, 0, 0.95), (0, 0, 1.05))
osso("tronco", (0, 0, 1.05), (0, 0, 1.60), "quadril")
for n, x in (("d", 0.115), ("e", -0.115)):
    osso(f"perna_{n}", (x, 0, 0.97), (x, 0.03, 0.55), "quadril")
    osso(f"canela_{n}", (x, 0.03, 0.55), (x, -0.01, 0.15), f"perna_{n}")
    osso(f"pe_{n}", (x, -0.01, 0.15), (x, 0.17, 0.08), f"canela_{n}")
bpy.ops.object.mode_set(mode="OBJECT")

soldado.parent = arm
mod = soldado.modifiers.new("Armature", "ARMATURE")
mod.object = arm

arm.animation_data_create()
FPS = 24
cena.render.fps = FPS


def girar(nome_osso, eixo_mundo, graus):
    """quaternion (no espaço local do osso) que gira 'graus' em torno de um eixo do mundo"""
    pb = arm.pose.bones[nome_osso]
    base = pb.bone.matrix_local.to_3x3()
    eixo_local = base.inverted() @ Vector(eixo_mundo)
    return Quaternion(eixo_local, math.radians(graus))


def clipe(nome, quadros, poses):
    """poses: {quadro: {osso: (tipo, valor)}} — 'rot' = (eixo, graus), 'pos' = (dx, dy, dz) no mundo"""
    acao = bpy.data.actions.new(nome)
    acao.use_fake_user = True
    arm.animation_data.action = acao
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    for q in quadros:
        for pb in arm.pose.bones:
            pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
            pb.location = Vector((0, 0, 0))
        for nome_osso, (tipo, valor) in poses[q].items():
            pb = arm.pose.bones[nome_osso]
            if tipo == "rot":
                pb.rotation_quaternion = girar(nome_osso, *valor)
            else:
                base = pb.bone.matrix_local.to_3x3()
                pb.location = base.inverted() @ Vector(valor)
        for pb in arm.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=q + 1)
            pb.keyframe_insert("location", frame=q + 1)
    acao.frame_range = (1, quadros[-1] + 1)


X = (1, 0, 0)
# ângulo positivo em X leva o pé para a frente (+Y). Canela e pé giram em relação ao osso pai,
# então "dobrar o joelho" é girar a canela para trás (negativo)
# correr: pernas alternando, joelho dobra na volta da perna, quadril sobe e desce duas vezes por ciclo
ciclo = 24
correr = {}
for q in range(0, ciclo + 1, 3):
    t = 2 * math.pi * q / ciclo
    s = math.sin(t)
    correr[q] = {
        "perna_d": ("rot", (X, 38 * s)),
        "perna_e": ("rot", (X, -38 * s)),
        "canela_d": ("rot", (X, -(12 + 50 * max(0.0, -math.cos(t + 0.6))))),
        "canela_e": ("rot", (X, -(12 + 50 * max(0.0, math.cos(t + 0.6))))),
        "pe_d": ("rot", (X, 8)),
        "pe_e": ("rot", (X, 8)),
        "quadril": ("pos", (0, 0, 0.035 * math.cos(2 * t))),
        "tronco": ("rot", (X, 5 + 2 * math.cos(2 * t))),
    }
clipe("correr", list(range(0, ciclo + 1, 3)), correr)

# agachado: quadril 0,44 m mais baixo; cada perna resolve o joelho para o pé ficar no chão.
# Coxa 0,42 m (0,97 -> 0,55), canela 0,40 m (0,55 -> 0,15), tornozelo a 0,15 m do chão
DESCIDA = 0.44
QUADRIL_Z = 0.97 - DESCIDA


def perna_no_chao(coxa_graus, pe_max=None):
    """dado o ângulo da coxa (para a frente), acha a canela que deixa o tornozelo a 0,15 m do chão.
    Devolve rotações relativas (coxa, canela, pé); o pé fica reto no chão (ou no máximo pe_max graus)"""
    a = math.radians(coxa_graus)
    c = (QUADRIL_Z - 0.15 - 0.42 * math.cos(a)) / 0.40
    b = math.degrees(math.acos(max(-1.0, min(1.0, c))))  # canela inclinada para trás, no mundo
    pe = b if pe_max is None else min(b, pe_max)
    return coxa_graus, -(coxa_graus + b), pe


def pose_agachado(frente):
    """frente = ângulo da coxa da perna da frente (direita); a de trás fica perto do chão"""
    d = perna_no_chao(frente)
    e = perna_no_chao(120 - frente, pe_max=25)  # perna de trás: joelho quase no chão, apoiada na ponta do pé
    return {
        "quadril": ("pos", (0, -0.02, -DESCIDA)),
        "perna_d": ("rot", (X, d[0])), "canela_d": ("rot", (X, d[1])), "pe_d": ("rot", (X, d[2])),
        "perna_e": ("rot", (X, e[0])), "canela_e": ("rot", (X, e[1])), "pe_e": ("rot", (X, e[2])),
    }


clipe("agachado", [0, 24], {0: pose_agachado(88), 24: pose_agachado(88)})
# andar agachado: as pernas trocam de lugar devagar (passos curtos)
andar = {}
for q in range(0, 33, 4):
    t = 2 * math.pi * q / 32
    andar[q] = pose_agachado(60 + 28 * math.sin(t))
    andar[q]["quadril"] = ("pos", (0, -0.02, -DESCIDA + 0.015 * abs(math.cos(t))))
clipe("agachado_andar", list(range(0, 33, 4)), andar)
# parado: respiração leve
parado = {}
for q in range(0, 49, 12):
    t = 2 * math.pi * q / 48
    parado[q] = {"tronco": ("rot", (X, 0.8 * math.sin(t))), "quadril": ("pos", (0, 0, 0.004 * math.sin(t)))}
clipe("parado", list(range(0, 49, 12)), parado)
arm.animation_data.action = None

# ---------------------------------------------------------------- exporta ----
bpy.ops.object.select_all(action="DESELECT")
soldado.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
kw = dict(
    filepath=os.path.join(AQUI, "soldado.glb"),
    export_format="GLB",
    use_selection=True,
    export_image_format="JPEG",
    export_jpeg_quality=88,
    export_apply=False,
    export_skins=True,
)
try:
    bpy.ops.export_scene.gltf(export_animation_mode="ACTIONS", **kw)
except TypeError:
    bpy.ops.export_scene.gltf(export_animations=True, export_nla_strips=True, **kw)

# ---------------------------------------------------------------- prévias (equipe pintada de verde-água, com um fuzil de enfeite) ----
eb.inputs["Base Color"].default_value = (0.05, 0.62, 0.45, 1)
fuzil_bm = bmesh.new()
bmesh.ops.create_cube(fuzil_bm, size=1.0)
for v in fuzil_bm.verts:
    v.co = Vector((v.co.x * 0.07, v.co.y * 0.85, v.co.z * 0.09))
fuzil = novo_objeto("fuzil_previa", fuzil_bm)
fuzil.location = (0.13, 0.5, 1.17)
fuzil.data.materials.append(material_simples("fuzil", (0.03, 0.03, 0.035), 0.5, 0.6, 20, 0.3))
preparar_foto(8)
foto("soldado", AQUI, (2.4, 3.6, 1.6), (0, 0.1, 0.95), lente=40)
foto("soldado_2", AQUI, (-3.2, -3.0, 1.7), (0, 0, 0.95), lente=40)
# pose de corrida na prévia
pb = arm.pose.bones
for pb_ in arm.pose.bones:
    pb_.rotation_mode = "QUATERNION"
pb["perna_d"].rotation_quaternion = girar("perna_d", X, 35)
pb["perna_e"].rotation_quaternion = girar("perna_e", X, -35)
pb["canela_e"].rotation_quaternion = girar("canela_e", X, -40)
foto("soldado_3", AQUI, (4.6, 0.2, 1.2), (0, 0, 0.9), lente=40)
# pose agachada na prévia (de lado e de frente)
for nome_osso, (tipo, valor) in pose_agachado(88).items():
    if tipo == "rot":
        pb[nome_osso].rotation_quaternion = girar(nome_osso, *valor)
    else:
        pb[nome_osso].location = pb[nome_osso].bone.matrix_local.to_3x3().inverted() @ Vector(valor)
fuzil.location = (0.13, 0.48, 1.17 - DESCIDA)
foto("soldado_agachado", AQUI, (4.6, 0.2, 0.9), (0, 0, 0.6), lente=40)
foto("soldado_agachado_2", AQUI, (2.6, 3.4, 1.3), (0, 0, 0.6), lente=40)
print("pronto")
