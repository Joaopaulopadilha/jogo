# Operário (malha texturizada do Meshy): reduz os polígonos, dá esqueleto humano, cria as animações e exporta para o jogo da retroescavadeira.
# Rodar:  blender --background --python operario.py [-- --rapido] [--sem-foto] [--tris=12000]
# Saídas: ../retroescavadeira/public/modelos/operario.glb e as prévias operario_*.png (na pasta modelos)
#
# A malha original tem ~80 mil triângulos e três texturas de 2048 px. Aqui ela é decimada (o UV é preservado, então a textura de cor
# e o mapa de normais continuam valendo), as texturas caem para 1024 px e a de metal-aspereza sai.
# Esqueleto: quadril > coluna > peito > pescoco > cabeca; peito > braco_e/d > antebraco > mao; quadril > coxa_e/d > canela > pe.
# Frente: -Y no Blender (vira +Z no jogo). "e" = esquerda do boneco = lado +X.
# Animações: parado, andar, correr, sentado (o jogo mistura com o AnimationMixer do three.js).

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
ORIGEM = os.path.join(AQUI, "Meshy_AI_Blue_Bucket_Stance_1029101339_texture.glb")
SAIDA = os.path.normpath(os.path.join(AQUI, "..", "retroescavadeira", "public", "modelos"))
os.makedirs(SAIDA, exist_ok=True)
ALTURA = 1.78
ALVO_TRIS = 12000
for a in sys.argv:
    if a.startswith("--tris="):
        ALVO_TRIS = int(a.split("=")[1])
TAM_TEX = 1024
FPS = 30

# ------------------------------------------------------------------ importar, pés em z=0, escala
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ORIGEM)
op = [x for x in bpy.data.objects if x.type == "MESH"][0]
op.data.transform(op.matrix_world)
op.matrix_world.identity()
vs = op.data.vertices
zmin = min(v.co.z for v in vs)
zmax = max(v.co.z for v in vs)
pes = [v.co for v in vs if v.co.z < zmin + 0.03]
cy = sum(p.y for p in pes) / len(pes)
K = ALTURA / (zmax - zmin)
for v in vs:
    v.co = Vector((v.co.x * K, (v.co.y - cy) * K, (v.co.z - zmin) * K))
op.data.update()
op.name = "operario"
bpy.context.view_layer.objects.active = op
op.select_set(True)
tris0 = sum(len(p.vertices) - 2 for p in op.data.polygons)

# ------------------------------------------------------------------ reduzir polígonos
dec = op.modifiers.new("decimar", "DECIMATE")
dec.decimate_type = "COLLAPSE"
dec.ratio = min(1.0, ALVO_TRIS / tris0)
dec.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="decimar")
for p in op.data.polygons:
    p.use_smooth = True
vs = op.data.vertices
print("triangulos", tris0, "->", sum(len(p.vertices) - 2 for p in op.data.polygons), "vertices", len(vs))

# ------------------------------------------------------------------ material com texturas menores (sem metal-aspereza)
mat = op.data.materials[0]
nt = mat.node_tree
bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
for lig in list(nt.links):
    if lig.to_node == bsdf and lig.to_socket.name in ("Metallic", "Roughness"):
        nt.links.remove(lig)
bsdf.inputs["Metallic"].default_value = 0.0
bsdf.inputs["Roughness"].default_value = 0.8
usados = set()
for n in nt.nodes:
    if n.type == "TEX_IMAGE" and n.image and any(l.from_node == n and l.to_node.type in ("BSDF_PRINCIPLED", "NORMAL_MAP") for l in nt.links):
        usados.add(n.image.name)
        n.image.scale(TAM_TEX, TAM_TEX)
for n in list(nt.nodes):
    if n.type == "TEX_IMAGE" and n.image and n.image.name not in usados:
        nt.nodes.remove(n)

# ------------------------------------------------------------------ esqueleto (medidas tiradas das fatias da malha original, em metros dela; K escala)
def P(x, y, z):
    return Vector((x * K, y * K, z * K))


JUNTAS = {
    "quadril": (P(0, 0.01, 0.9), P(0, 0.01, 1.05)),
    "coluna": (P(0, 0.01, 1.05), P(0, 0.0, 1.3)),
    "peito": (P(0, 0.0, 1.3), P(0, 0.0, 1.55)),
    "pescoco": (P(0, 0.0, 1.55), P(0.01, -0.01, 1.68)),
    "cabeca": (P(0.01, -0.01, 1.68), P(0.02, -0.01, 1.9)),
}
for nome, s in (("e", 1), ("d", -1)):
    JUNTAS[f"braco_{nome}"] = (P(s * 0.19, 0.01, 1.45), P(s * 0.25, 0.02, 1.15))
    JUNTAS[f"antebraco_{nome}"] = (P(s * 0.25, 0.02, 1.15), P(s * 0.27, 0.0, 0.93))
    JUNTAS[f"mao_{nome}"] = (P(s * 0.27, 0.0, 0.93), P(s * 0.28, -0.01, 0.82))
    JUNTAS[f"coxa_{nome}"] = (P(s * 0.11, 0.01, 0.9), P(s * 0.17, 0.02, 0.5))
    JUNTAS[f"canela_{nome}"] = (P(s * 0.17, 0.02, 0.5), P(s * 0.22, 0.03, 0.09))
    JUNTAS[f"pe_{nome}"] = (P(s * 0.22, 0.03, 0.09), P(s * 0.24, -0.11, 0.02))
PAIS = {"coluna": "quadril", "peito": "coluna", "pescoco": "peito", "cabeca": "pescoco"}
for nome in ("e", "d"):
    PAIS.update({f"braco_{nome}": "peito", f"antebraco_{nome}": f"braco_{nome}", f"mao_{nome}": f"antebraco_{nome}",
                 f"coxa_{nome}": "quadril", f"canela_{nome}": f"coxa_{nome}", f"pe_{nome}": f"canela_{nome}"})

arm_data = bpy.data.armatures.new("esqueleto")
arm = bpy.data.objects.new("esqueleto", arm_data)
u.cena().collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for nome, (a, b) in JUNTAS.items():
    eb = arm_data.edit_bones.new(nome)
    eb.head = a
    eb.tail = b
    # eixo Z local apontando para a frente (-Y): girar em X dobra para frente/trás em todos os ossos
    eb.align_roll(Vector((0, -1, 0)) if abs(b.z - a.z) > abs(b.y - a.y) else Vector((0, 0, 1)))
for nome, pai in PAIS.items():
    arm_data.edit_bones[nome].parent = arm_data.edit_bones[pai]
    arm_data.edit_bones[nome].use_connect = (arm_data.edit_bones[nome].head - arm_data.edit_bones[pai].tail).length < 1e-4
bpy.ops.object.mode_set(mode="OBJECT")

# ------------------------------------------------------------------ pesos: distância aos ossos, só entre os ossos da região do vértice
def dist_segmento(p, a, b):
    seg = b - a
    t = max(0.0, min(1.0, (p - a).dot(seg) / seg.length_squared))
    return (p - (a + seg * t)).length


TRONCO = ["quadril", "coluna", "peito"]


def candidatos(co):
    x, z = co.x / K, co.z / K  # na medida original
    lado = "e" if x > 0 else "d"
    ax = abs(x)
    if z > 1.52:
        return ["peito", "pescoco", "cabeca"]
    # braços: soltos do tronco entre 0,95 e 1,35; abaixo disso a mão encosta na coxa (mão = |x| > 0,205)
    if (0.95 <= z <= 1.4 and ax > 0.195) or (0.78 <= z < 0.95 and ax > 0.205):
        return [f"braco_{lado}", f"antebraco_{lado}", f"mao_{lado}"]
    if z >= 1.4 and ax > 0.17:
        return ["peito", f"braco_{lado}"]
    if z < 0.86 or (z < 0.98 and ax > 0.06):
        lista = [f"coxa_{lado}", f"canela_{lado}", f"pe_{lado}"]
        return lista + (["quadril"] if z > 0.75 else [])
    return TRONCO + (["pescoco"] if z > 1.45 else [])


for nome in JUNTAS:
    op.vertex_groups.new(name=nome)
for v in vs:
    cand = candidatos(v.co)
    ds = sorted(((dist_segmento(v.co, *JUNTAS[n]), n) for n in cand))[:3]
    pesos = [(n, 1.0 / (d ** 4 + 1e-7)) for d, n in ds]
    soma = sum(w for _, w in pesos)
    for n, w in pesos:
        if w / soma > 0.01:
            op.vertex_groups[n].add([v.index], w / soma, "REPLACE")

mod = op.modifiers.new("esqueleto", "ARMATURE")
mod.object = arm
op.parent = arm

# ------------------------------------------------------------------ cabeça para a frente
# O modelo veio olhando para o lado esquerdo. Mede o ângulo pelo nariz (ponto mais à frente do rosto, abaixo do chapéu),
# gira pescoço e cabeça no sentido contrário e grava a deformação na malha (vira a pose de repouso).
cab = [v.co for v in vs if 1.66 * K < v.co.z < 1.78 * K]
cx = sum(c.x for c in cab) / len(cab)
cy_ = sum(c.y for c in cab) / len(cab)
nariz = min(cab, key=lambda c: c.y)
angulo = math.atan2(nariz.x - cx, -(nariz.y - cy_))
if "--angulo-cabeca" in " ".join(sys.argv):
    angulo = math.radians(float([a for a in sys.argv if a.startswith("--angulo-cabeca=")][0].split("=")[1]))
print("cabeca virada", round(math.degrees(angulo), 1), "graus (nariz em", tuple(round(x, 3) for x in nariz), ")")
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
arm.pose.bones["pescoco"].rotation_euler = (0, -angulo * 0.4, 0)  # Y local do osso = vertical
arm.pose.bones["cabeca"].rotation_euler = (0, -angulo * 0.6, 0)
bpy.context.view_layer.update()
bpy.context.view_layer.objects.active = op
bpy.ops.object.select_all(action="DESELECT")
op.select_set(True)
bpy.ops.object.modifier_apply(modifier="esqueleto")
for pb in arm.pose.bones:
    pb.rotation_euler = (0, 0, 0)
mod = op.modifiers.new("esqueleto", "ARMATURE")
mod.object = arm

# ------------------------------------------------------------------ animações
cena = u.cena()
cena.render.fps = FPS
arm.animation_data_create()
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
pose = arm.pose.bones

# pernas um pouco fechadas (o modelo veio de pernas abertas) e braços mais junto do corpo, em todas as animações
# o modelo veio de pernas abertas (tornozelo 11 cm para fora do quadril): cada coxa gira ~7° para dentro em volta
# do eixo da frente (Z local), e o pé fica embaixo do quadril. Lado "e" (+X) gira negativo, "d" positivo.
FECHAR_PERNAS = 0.13
for a in sys.argv:
    if a.startswith("--fechar-pernas="):
        FECHAR_PERNAS = float(a.split("=")[1])
BASE = {}
for nome, s in (("e", 1), ("d", -1)):
    BASE[f"coxa_{nome}"] = (0, 0, -s * FECHAR_PERNAS)


def chave(quadro, rot, loc=None):
    """rot: {osso: (x, y, z)} em radianos; ossos fora da lista voltam ao zero"""
    for pb in pose:
        r = rot.get(pb.name, (0, 0, 0))
        b = BASE.get(pb.name, (0, 0, 0))
        pb.rotation_euler = (r[0] + b[0], r[1] + b[1], r[2] + b[2])
        pb.keyframe_insert("rotation_euler", frame=quadro)
        pb.location = (0, 0, 0)
        if loc and pb.name in loc:
            pb.location = loc[pb.name]
        pb.keyframe_insert("location", frame=quadro)


def nova_acao(nome):
    act = bpy.data.actions.new(nome)
    act.use_fake_user = True
    arm.animation_data.action = act
    return act


def ciclo(nome, quadros, funcao):
    act = nova_acao(nome)
    for f in range(quadros + 1):
        t = f / quadros * 2 * math.pi
        rot, loc = funcao(t)
        chave(f + 1, rot, loc)
    return act


S_FRENTE = 1  # sinal da rotação em X que leva o osso para a frente (conferido nas fotos)


def andar(t, forte=1.0, correr=False):
    a = 0.42 * forte
    rot = {}
    for nome, fase in (("e", 0.0), ("d", math.pi)):
        s = math.sin(t + fase)
        # coxa: vai e volta; joelho dobra quando a perna passa à frente; pé acompanha
        rot[f"coxa_{nome}"] = (S_FRENTE * a * s, 0, 0)
        joelho = max(0.0, math.sin(t + fase + 1.2)) * (1.1 if correr else 0.75) + 0.05
        rot[f"canela_{nome}"] = (-S_FRENTE * joelho, 0, 0)
        rot[f"pe_{nome}"] = (S_FRENTE * 0.25 * max(0.0, -s), 0, 0)
        # braço do lado oposto
        rot[f"braco_{nome}"] = (-S_FRENTE * (0.32 if not correr else 0.55) * forte * s, 0, 0)
        rot[f"antebraco_{nome}"] = (S_FRENTE * (1.25 if correr else 0.25 + 0.15 * max(0.0, -s)), 0, 0)
    rot["coluna"] = (S_FRENTE * (0.18 if correr else 0.04), 0.06 * math.sin(t), 0)
    rot["peito"] = (0, -0.08 * math.sin(t) * forte, 0)
    rot["cabeca"] = (0, 0.05 * math.sin(t), 0)
    sobe = (0.045 if correr else 0.025) * abs(math.cos(t))
    return rot, {"quadril": (0, sobe, 0)}  # location do osso quadril: Y local = para cima


def parado(t):
    resp = math.sin(t)
    rot = {"peito": (S_FRENTE * 0.02 * resp, 0, 0), "cabeca": (0, 0.04 * math.sin(t * 0.5 + 1), 0)}
    for nome in ("e", "d"):
        rot[f"braco_{nome}"] = (-S_FRENTE * 0.02 * resp, 0, 0)
        rot[f"antebraco_{nome}"] = (S_FRENTE * 0.12, 0, 0)
    return rot, None


ciclo("parado", 90, parado)
ciclo("andar", 32, lambda t: andar(t))
ciclo("correr", 20, lambda t: andar(t, 1.5, True))

act = nova_acao("sentado")
sent = {}
for nome in ("e", "d"):
    sent[f"coxa_{nome}"] = (S_FRENTE * 1.45, 0, 0)
    sent[f"canela_{nome}"] = (-S_FRENTE * 1.5, 0, 0)
    sent[f"pe_{nome}"] = (S_FRENTE * 0.1, 0, 0)
    sent[f"braco_{nome}"] = (S_FRENTE * 0.65, 0, 0)
    sent[f"antebraco_{nome}"] = (S_FRENTE * 0.75, 0, 0)
sent["coluna"] = (-S_FRENTE * 0.08, 0, 0)
chave(1, sent)
chave(30, sent)


# agachado: quadril desce ~33 cm; coxa a 63° para a frente, canela 47° para trás, pé no chão, tronco inclinado
def agachar(t, andando):
    rot = {}
    for nome, fase in (("e", 0.0), ("d", math.pi)):
        s = math.sin(t + fase) if andando else 0.0
        coxa = 1.1 + 0.28 * s
        canela = 1.92 + (0.25 * max(0.0, math.sin(t + fase + 1.2)) if andando else 0.0)
        rot[f"coxa_{nome}"] = (S_FRENTE * coxa, 0, 0)
        rot[f"canela_{nome}"] = (-S_FRENTE * canela, 0, 0)
        rot[f"pe_{nome}"] = (S_FRENTE * (canela - coxa), 0, 0)  # pé paralelo ao chão
        rot[f"braco_{nome}"] = (S_FRENTE * (0.35 - 0.2 * s), 0, 0)
        rot[f"antebraco_{nome}"] = (S_FRENTE * 0.7, 0, 0)
    rot["coluna"] = (S_FRENTE * 0.35, 0, 0)
    rot["peito"] = (S_FRENTE * 0.1, 0, 0)
    rot["cabeca"] = (-S_FRENTE * 0.3, 0, 0)
    return rot, {"quadril": (0, -0.33 + (0.015 * abs(math.cos(t)) if andando else 0.01 * math.sin(t)), 0)}


ciclo("agachado", 60, lambda t: agachar(t, False))
ciclo("agachado_andar", 36, lambda t: agachar(t, True))

# escalar: braços acima da cabeça puxando e pernas alternando, como subindo numa parede
def escalar(t):
    rot = {}
    for nome, fase in (("e", 0.0), ("d", math.pi)):
        s = math.sin(t + fase)
        rot[f"braco_{nome}"] = (S_FRENTE * (2.5 + 0.35 * s), 0, 0)
        rot[f"antebraco_{nome}"] = (S_FRENTE * (0.5 - 0.4 * s), 0, 0)
        rot[f"coxa_{nome}"] = (S_FRENTE * (0.8 + 0.6 * s), 0, 0)
        rot[f"canela_{nome}"] = (-S_FRENTE * (1.0 + 0.6 * s), 0, 0)
        rot[f"pe_{nome}"] = (S_FRENTE * 0.2, 0, 0)
    rot["coluna"] = (S_FRENTE * 0.15, 0, 0)
    rot["cabeca"] = (-S_FRENTE * 0.35, 0, 0)
    return rot, None


ciclo("escalar", 24, escalar)

# pulo: no ar, joelhos dobrados e braços para cima
act = nova_acao("pulo")
pulo = {}
for nome in ("e", "d"):
    pulo[f"coxa_{nome}"] = (S_FRENTE * 0.55, 0, 0)
    pulo[f"canela_{nome}"] = (-S_FRENTE * 1.0, 0, 0)
    pulo[f"pe_{nome}"] = (-S_FRENTE * 0.3, 0, 0)
    pulo[f"braco_{nome}"] = (S_FRENTE * 1.2, 0, 0)
    pulo[f"antebraco_{nome}"] = (S_FRENTE * 0.5, 0, 0)
pulo["coluna"] = (S_FRENTE * 0.08, 0, 0)
chave(1, pulo)
chave(30, pulo)
arm.animation_data.action = bpy.data.actions["parado"]

# ------------------------------------------------------------------ exportar
bpy.ops.object.select_all(action="DESELECT")
op.select_set(True)
arm.select_set(True)
opcoes = dict(filepath=os.path.join(SAIDA, "operario.glb"), export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
              export_skins=True, export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
              export_image_format="JPEG", export_jpeg_quality=86)
bpy.ops.export_scene.gltf(**opcoes)
print("exportado", opcoes["filepath"], os.path.getsize(opcoes["filepath"]) // 1024, "KB")

# ------------------------------------------------------------------ fotos de conferência
if "--sem-foto" not in sys.argv:
    u.preparar_foto(5)
    arm.hide_render = True
    for nome_acao, quadro, foto in (("parado", 1, "operario_parado"), ("andar", 9, "operario_andar"), ("sentado", 1, "operario_sentado"),
                                    ("agachado", 1, "operario_agachado"), ("agachado_andar", 9, "operario_agachado_andar"), ("pulo", 1, "operario_pulo"),
                                    ("escalar", 7, "operario_escalar")):
        arm.animation_data.action = bpy.data.actions[nome_acao]
        cena.frame_set(quadro)
        u.foto(foto + "_lado", AQUI, (4.2, -0.6, 1.0), (0, 0, 0.85), lente=45)
        u.foto(foto + "_frente", AQUI, (0.6, -4.2, 1.0), (0, 0, 0.85), lente=45)
print("pronto")
