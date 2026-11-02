# Aventureiro lhama (malha texturizada do Meshy): reduz os polígonos, dá esqueleto humanoide (com cauda), cria as animações e exporta para o jogo da retroescavadeira.
# Rodar:  blender --background --python lhama.py [-- --sem-foto] [--tris=14000] [--fechar-pernas=0.35] [--fechar-bracos=0.4]
# Saídas: ../retroescavadeira/public/modelos/lhama.glb e as prévias lhama_*.png (na pasta modelos)
#
# A malha original tem ~236 mil triângulos e três texturas de 2048 px. Aqui ela é decimada (o UV é preservado, então a textura de cor
# e o mapa de normais continuam valendo e seguram o relevo da lã), as texturas caem para 1024 px e a de metal-aspereza sai.
# Esqueleto: quadril > coluna > peito > pescoco > cabeca; peito > braco_e/d > antebraco > mao; quadril > coxa_e/d > canela > pe;
# quadril > cauda1 > cauda2. Mesmos nomes de ossos e de animações do operário (parado, andar, correr, sentado, agachado,
# agachado_andar, escalar, pulo), então o jogo troca de personagem só trocando o arquivo.
# Frente: -Y no Blender (vira +Z no jogo). "e" = esquerda do boneco = lado +X.

import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
ORIGEM = os.path.normpath(os.path.join(AQUI, "..", "Meshy_AI_Llama_Adventurer_1102165911_texture.glb"))
SAIDA = os.path.normpath(os.path.join(AQUI, "..", "retroescavadeira", "public", "modelos"))
os.makedirs(SAIDA, exist_ok=True)
ALTURA = 1.7  # com as orelhas; um pouco menor que o operário (a cabeça é grande)
ALVO_TRIS = 14000
FECHAR_PERNAS = 0.35  # o modelo veio de pernas bem abertas
FECHAR_BRACOS = 0.4  # e de braços em A
for a in sys.argv:
    if a.startswith("--tris="):
        ALVO_TRIS = int(a.split("=")[1])
    if a.startswith("--fechar-pernas="):
        FECHAR_PERNAS = float(a.split("=")[1])
    if a.startswith("--fechar-bracos="):
        FECHAR_BRACOS = float(a.split("=")[1])
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
op.name = "lhama"
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
    "quadril": (P(0, 0.03, 0.58), P(0, 0.03, 0.78)),
    "coluna": (P(0, 0.03, 0.78), P(0, 0.03, 1.0)),
    "peito": (P(0, 0.03, 1.0), P(0, 0.03, 1.24)),
    "pescoco": (P(0, 0.03, 1.24), P(0, -0.02, 1.40)),
    "cabeca": (P(0, -0.02, 1.40), P(0, -0.04, 1.90)),
    "cauda1": (P(0, 0.22, 0.68), P(0, 0.40, 0.66)),
    "cauda2": (P(0, 0.40, 0.66), P(0, 0.58, 0.60)),
}
for nome, s in (("e", 1), ("d", -1)):
    JUNTAS[f"braco_{nome}"] = (P(s * 0.28, 0.02, 1.17), P(s * 0.50, 0.02, 0.98))
    JUNTAS[f"antebraco_{nome}"] = (P(s * 0.50, 0.02, 0.98), P(s * 0.64, 0.0, 0.88))
    JUNTAS[f"mao_{nome}"] = (P(s * 0.64, 0.0, 0.88), P(s * 0.73, -0.02, 0.80))
    JUNTAS[f"coxa_{nome}"] = (P(s * 0.16, 0.07, 0.60), P(s * 0.31, 0.09, 0.30))
    JUNTAS[f"canela_{nome}"] = (P(s * 0.31, 0.09, 0.30), P(s * 0.41, 0.07, 0.10))
    JUNTAS[f"pe_{nome}"] = (P(s * 0.41, 0.07, 0.10), P(s * 0.43, -0.09, 0.03))
PAIS = {"coluna": "quadril", "peito": "coluna", "pescoco": "peito", "cabeca": "pescoco", "cauda1": "quadril", "cauda2": "cauda1"}
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
    x, y, z = co.x / K, co.y / K, co.z / K  # na medida original
    lado = "e" if x > 0 else "d"
    ax = abs(x)
    if y > 0.3 and z < 0.8 and ax < 0.2:
        return ["cauda1", "cauda2", "quadril"]
    if z > 1.3:
        return ["peito", "pescoco", "cabeca"]
    # braços: o que está fora da largura do tronco e perto da linha do braço (o resto, como as bolsas do cinto, fica no corpo)
    if ax > 0.31 and z > 0.72:
        d = min(dist_segmento(co, *JUNTAS[f"{n}_{lado}"]) for n in ("braco", "antebraco", "mao")) / K
        if d < 0.16:
            return ["peito", f"braco_{lado}", f"antebraco_{lado}", f"mao_{lado}"]
    if z < 0.74:
        lista = [f"coxa_{lado}", f"canela_{lado}", f"pe_{lado}"]
        if z > 0.62:
            return ["quadril", "coluna", f"coxa_{lado}"]
        return lista + (["quadril"] if z > 0.5 else [])
    return TRONCO + (["pescoco"] if z > 1.2 else [])


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

# ------------------------------------------------------------------ animações
cena = u.cena()
cena.render.fps = FPS
arm.animation_data_create()
for pb in arm.pose.bones:
    pb.rotation_mode = "XYZ"
pose = arm.pose.bones

# pernas e braços fecham um pouco em todas as animações: gira em volta do eixo da frente (Z local).
# Lado "e" (+X) gira negativo, "d" positivo.
BASE = {}
for nome, s in (("e", 1), ("d", -1)):
    BASE[f"coxa_{nome}"] = (0, 0, -s * FECHAR_PERNAS)
    BASE[f"braco_{nome}"] = (0, 0, -s * FECHAR_BRACOS)


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


def cauda(rot, t, forca=1.0):
    # a cauda balança de um lado para o outro (Z local = para cima) e sobe e desce um pouco
    rot["cauda1"] = (0.08 * math.sin(t * 2) * forca, 0, 0.30 * math.sin(t) * forca)
    rot["cauda2"] = (0.10 * math.sin(t * 2 + 0.8) * forca, 0, 0.35 * math.sin(t - 0.7) * forca)


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
    cauda(rot, t * 2 if not correr else t * 2, 1.2 if correr else 0.8)
    sobe = (0.045 if correr else 0.025) * abs(math.cos(t))
    return rot, {"quadril": (0, sobe, 0)}  # location do osso quadril: Y local = para cima


def parado(t):
    resp = math.sin(t)
    rot = {"peito": (S_FRENTE * 0.02 * resp, 0, 0), "cabeca": (0, 0.04 * math.sin(t * 0.5 + 1), 0)}
    for nome in ("e", "d"):
        rot[f"braco_{nome}"] = (-S_FRENTE * 0.02 * resp, 0, 0)
        rot[f"antebraco_{nome}"] = (S_FRENTE * 0.12, 0, 0)
    cauda(rot, t, 0.5)
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
sent["cauda1"] = (-0.25, 0, 0)  # a cauda sai por trás do banco
chave(1, sent)
chave(30, sent)


# agachado: quadril desce; coxa para a frente, canela para trás, pé no chão, tronco inclinado
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
    cauda(rot, t, 0.5)
    return rot, {"quadril": (0, -0.30 + (0.015 * abs(math.cos(t)) if andando else 0.01 * math.sin(t)), 0)}


ciclo("agachado", 60, lambda t: agachar(t, False))
ciclo("agachado_andar", 36, lambda t: agachar(t, True))


# escalar: braços acima da cabeça puxando e pernas alternando, como subindo numa parede
def escalar(t):
    rot = {}
    for nome, fase in (("e", 0.0), ("d", math.pi)):
        s = math.sin(t + fase)
        # braços abertos para os lados (a cabeça é grande: de frente as mãos passariam pelo rosto)
        rot[f"braco_{nome}"] = (S_FRENTE * (2.2 + 0.35 * s), 0, (-1 if nome == "e" else 1) * 1.0)  # braço para cima: o sinal do giro lateral é o contrário do braço pendurado
        rot[f"antebraco_{nome}"] = (S_FRENTE * (0.5 - 0.4 * s), 0, 0)
        rot[f"coxa_{nome}"] = (S_FRENTE * (0.8 + 0.6 * s), 0, 0)
        rot[f"canela_{nome}"] = (-S_FRENTE * (1.0 + 0.6 * s), 0, 0)
        rot[f"pe_{nome}"] = (S_FRENTE * 0.2, 0, 0)
    rot["coluna"] = (S_FRENTE * 0.15, 0, 0)
    rot["cabeca"] = (-S_FRENTE * 0.35, 0, 0)
    cauda(rot, t, 0.6)
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
pulo["cauda1"] = (0.35, 0, 0)
chave(1, pulo)
chave(30, pulo)
arm.animation_data.action = bpy.data.actions["parado"]

# ------------------------------------------------------------------ exportar
bpy.ops.object.select_all(action="DESELECT")
op.select_set(True)
arm.select_set(True)
opcoes = dict(filepath=os.path.join(SAIDA, "lhama.glb"), export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
              export_skins=True, export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
              export_image_format="JPEG", export_jpeg_quality=86)
bpy.ops.export_scene.gltf(**opcoes)
print("exportado", opcoes["filepath"], os.path.getsize(opcoes["filepath"]) // 1024, "KB")

# ------------------------------------------------------------------ fotos de conferência
if "--sem-foto" not in sys.argv:
    u.preparar_foto(5)
    arm.hide_render = True
    pasta_foto = AQUI
    for a in sys.argv:
        if a.startswith("--pasta="):
            pasta_foto = a.split("=", 1)[1]
    for nome_acao, quadro, foto in (("parado", 1, "lhama_parado"), ("andar", 9, "lhama_andar"), ("sentado", 1, "lhama_sentado"),
                                    ("agachado", 1, "lhama_agachado"), ("pulo", 1, "lhama_pulo"), ("escalar", 7, "lhama_escalar")):
        arm.animation_data.action = bpy.data.actions[nome_acao]
        cena.frame_set(quadro)
        u.foto(foto + "_lado", pasta_foto, (4.2, -0.6, 0.9), (0, 0, 0.8), lente=45)
        u.foto(foto + "_frente", pasta_foto, (0.6, -4.2, 0.9), (0, 0, 0.8), lente=45)
print("pronto")
