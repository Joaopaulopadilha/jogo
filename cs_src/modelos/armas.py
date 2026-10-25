# Armas do CS Caps: fuzil de assalto, pistola e granada (low poly detalhado, uma textura por arma).
# Rodar:  blender --background --python armas.py [-- --rapido]
# Saídas: armas.glb (três objetos: "fuzil", "pistola", "granada") e armas.png / armas_2.png (prévias)
#
# Medidas em metros. A origem de cada arma é a MÃO que segura (a empunhadura) e o cano aponta para +Y no Blender
# (no jogo, para -Z, como a câmera). Pontas do cano: fuzil y=0,66 | pistola y=0,20 (o jogo usa para o clarão e o traço do tiro).

import math
import os
import sys
import tempfile

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u  # noqa: E402
from blender_util import RAPIDO, ativar, foto, material_simples, novo_objeto, preparar_foto  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)

M_METAL = material_simples("metal", (0.030, 0.032, 0.036), 0.38, 0.8, 24, 0.35)
M_POLIMERO = material_simples("polimero", (0.012, 0.012, 0.014), 0.7, 0.0, 30, 0.35)
M_DESGASTE = material_simples("desgaste", (0.10, 0.10, 0.11), 0.35, 0.9, 40, 0.5)
M_MADEIRA = material_simples("madeira", (0.06, 0.028, 0.012), 0.7, 0.0, 12, 0.5)
M_VIDRO = material_simples("lente", (0.01, 0.03, 0.05), 0.15, 0.2, 40, 0.3)
M_MANGA = material_simples("manga", (0.05, 0.062, 0.034), 0.9, 0.0, 22, 0.5)
M_LUVA = material_simples("luva", (0.02, 0.02, 0.022), 0.85, 0.0, 34, 0.4)
M_VERDE = material_simples("granada_verde", (0.085, 0.115, 0.045), 0.55, 0.3, 18, 0.45)


def caixa(partes, nome, centro, dim, material, bisel=0.004, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dim[0], v.co.y * dim[1], v.co.z * dim[2]))
    if bisel:
        bmesh.ops.bevel(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], offset=bisel, segments=2, profile=0.7, affect="EDGES")
    m = Matrix.Translation(centro) @ Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    partes.append(o)
    return o


def cilindro(partes, nome, a, b, r1, r2, material, seg=14):
    """cilindro entre os pontos a e b (raio r1 em a, r2 em b)"""
    a, b = Vector(a), Vector(b)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=(b - a).length)
    q = Vector((0, 0, 1)).rotation_difference(b - a)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    partes.append(o)
    return o


def elipsoide(partes, nome, centro, raios, material, seg=16, aneis=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=aneis, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * raios[0], v.co.y * raios[1], v.co.z * raios[2])) + Vector(centro)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    partes.append(o)
    return o


def aro(partes, nome, centro, raio, espessura, material, rot=(0, 0, 0)):
    """argola (torus) — usada na guarda do gatilho e no pino da granada"""
    bm = bmesh.new()
    n_maior, n_menor = 18, 6
    for i in range(n_maior):
        a = 2 * math.pi * i / n_maior
        for j in range(n_menor):
            b = 2 * math.pi * j / n_menor
            r = raio + espessura * math.cos(b)
            bm.verts.new((r * math.cos(a), r * math.sin(a), espessura * math.sin(b)))
    bm.verts.ensure_lookup_table()
    for i in range(n_maior):
        for j in range(n_menor):
            a = bm.verts[i * n_menor + j]
            b = bm.verts[i * n_menor + (j + 1) % n_menor]
            c = bm.verts[((i + 1) % n_maior) * n_menor + (j + 1) % n_menor]
            d = bm.verts[((i + 1) % n_maior) * n_menor + j]
            bm.faces.new((a, b, c, d))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    m = Matrix.Translation(centro) @ Matrix.Rotation(math.radians(rot[2]), 4, "Z") @ Matrix.Rotation(math.radians(rot[1]), 4, "Y") @ Matrix.Rotation(math.radians(rot[0]), 4, "X")
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    partes.append(o)
    return o


def fuzil():
    p = []
    # corpo: ferrolho/ejetor, caixa da culatra, guarda-mão com trilho, cano, quebra-chamas
    caixa(p, "culatra", (0, 0.13, 0.062), (0.044, 0.34, 0.072), M_METAL)
    caixa(p, "ejetor", (0.024, 0.13, 0.075), (0.008, 0.07, 0.03), M_DESGASTE, 0.002)
    caixa(p, "guarda_mao_cima", (0, 0.40, 0.066), (0.050, 0.28, 0.052), M_POLIMERO, 0.008)
    caixa(p, "guarda_mao_baixo", (0, 0.40, 0.032), (0.046, 0.28, 0.030), M_POLIMERO, 0.008)
    caixa(p, "trilho", (0, 0.30, 0.103), (0.020, 0.52, 0.014), M_METAL, 0.002)
    cilindro(p, "cano", (0, 0.50, 0.060), (0, 0.66, 0.060), 0.0115, 0.0105, M_METAL)
    cilindro(p, "quebra_chamas", (0, 0.66, 0.060), (0, 0.715, 0.060), 0.0185, 0.0165, M_METAL, 10)
    caixa(p, "bloco_gas", (0, 0.545, 0.085), (0.020, 0.030, 0.034), M_METAL, 0.003)
    caixa(p, "massa_mira", (0, 0.545, 0.108), (0.007, 0.012, 0.024), M_DESGASTE, 0.002)
    # coronha e tubo
    cilindro(p, "tubo_coronha", (0, -0.015, 0.060), (0, -0.115, 0.058), 0.020, 0.020, M_METAL, 10)
    caixa(p, "coronha", (0, -0.215, 0.040), (0.040, 0.20, 0.090), M_POLIMERO, 0.014, rot=(8, 0, 0))
    caixa(p, "apoio_rosto", (0, -0.20, 0.098), (0.034, 0.17, 0.014), M_POLIMERO, 0.005)
    caixa(p, "soleira", (0, -0.318, 0.040), (0.042, 0.016, 0.112), M_METAL, 0.004, rot=(8, 0, 0))
    # empunhadura (origem do modelo: a mão fica aqui), guarda do gatilho, gatilho
    caixa(p, "empunhadura", (0, -0.012, -0.040), (0.034, 0.046, 0.115), M_POLIMERO, 0.010, rot=(-16, 0, 0))
    caixa(p, "guarda_gatilho_a", (0, 0.045, 0.002), (0.012, 0.075, 0.012), M_METAL, 0.002)
    caixa(p, "guarda_gatilho_b", (0, 0.082, 0.020), (0.012, 0.012, 0.050), M_METAL, 0.002)
    caixa(p, "gatilho", (0, 0.022, 0.012), (0.008, 0.010, 0.030), M_DESGASTE, 0.002, rot=(20, 0, 0))
    # carregador curvo
    caixa(p, "carregador", (0, 0.118, -0.070), (0.030, 0.062, 0.150), M_METAL, 0.006, rot=(10, 0, 0))
    caixa(p, "carregador_base", (0, 0.140, -0.150), (0.032, 0.066, 0.014), M_POLIMERO, 0.004, rot=(10, 0, 0))
    # mira: base, tubo e lente do holográfico, alça na traseira
    caixa(p, "mira_base", (0, 0.095, 0.120), (0.030, 0.090, 0.016), M_POLIMERO, 0.004)
    caixa(p, "mira_corpo", (0, 0.095, 0.150), (0.036, 0.085, 0.052), M_POLIMERO, 0.008)
    caixa(p, "mira_lente", (0, 0.140, 0.150), (0.026, 0.004, 0.038), M_VIDRO, 0.001)
    caixa(p, "alavanca_carga", (0.0, -0.01, 0.108), (0.026, 0.020, 0.012), M_METAL, 0.002)
    return p


def pistola():
    p = []
    caixa(p, "ferrolho", (0, 0.075, 0.050), (0.030, 0.205, 0.038), M_METAL, 0.005)
    caixa(p, "serrilha", (0, -0.005, 0.052), (0.032, 0.040, 0.030), M_DESGASTE, 0.002)
    cilindro(p, "boca", (0, 0.172, 0.050), (0, 0.205, 0.050), 0.0075, 0.0072, M_DESGASTE, 10)
    caixa(p, "armacao", (0, 0.060, 0.022), (0.028, 0.170, 0.026), M_POLIMERO, 0.005)
    caixa(p, "empunhadura", (0, -0.014, -0.040), (0.032, 0.052, 0.110), M_POLIMERO, 0.008, rot=(-14, 0, 0))
    caixa(p, "guarda_gatilho_a", (0, 0.050, 0.000), (0.010, 0.060, 0.010), M_POLIMERO, 0.002)
    caixa(p, "guarda_gatilho_b", (0, 0.078, 0.014), (0.010, 0.010, 0.036), M_POLIMERO, 0.002)
    caixa(p, "gatilho", (0, 0.034, 0.010), (0.007, 0.009, 0.026), M_DESGASTE, 0.002, rot=(18, 0, 0))
    caixa(p, "mira_dianteira", (0, 0.190, 0.073), (0.006, 0.010, 0.012), M_DESGASTE, 0.001)
    caixa(p, "mira_traseira", (0, 0.002, 0.073), (0.018, 0.010, 0.010), M_DESGASTE, 0.001)
    caixa(p, "carregador_base", (0, -0.020, -0.100), (0.030, 0.052, 0.012), M_METAL, 0.003, rot=(-14, 0, 0))
    return p


def granada():
    p = []
    # corpo oval com gomos, tampa, pavio, alavanca ("colher") e pino com argola. Centro da granada em y=0.10
    elipsoide(p, "corpo", (0, 0.10, 0), (0.036, 0.036, 0.048), M_VERDE, 18, 12)
    for k in range(3):
        z = -0.020 + k * 0.020
        aro(p, f"gomo_{k}", (0, 0.10, z), 0.0345 + (0.003 if k == 1 else 0.0), 0.0035, M_VERDE, rot=(0, 0, 0))
    cilindro(p, "pescoco", (0, 0.10, 0.044), (0, 0.10, 0.060), 0.016, 0.014, M_METAL, 12)
    cilindro(p, "pavio", (0, 0.10, 0.060), (0, 0.10, 0.075), 0.011, 0.011, M_DESGASTE, 10)
    caixa(p, "alavanca", (0.020, 0.10, 0.020), (0.008, 0.026, 0.100), M_METAL, 0.002, rot=(0, 8, 0))
    caixa(p, "alavanca_ponta", (0.030, 0.10, -0.030), (0.008, 0.026, 0.030), M_METAL, 0.002, rot=(0, -10, 0))
    cilindro(p, "pino", (0.003, 0.092, 0.058), (0.003, 0.125, 0.058), 0.0030, 0.0030, M_DESGASTE, 6)
    aro(p, "argola", (0.004, 0.134, 0.058), 0.014, 0.0022, M_DESGASTE, rot=(90, 0, 0))
    return p



def mao(partes, nome, palma, dim_palma, rot, dedos, polegar, antebraco_de, antebraco_ate, lado=1):
    """luva simples: palma + dedos enrolados + polegar, e o antebraço (manga) saindo para trás, em direção à câmera"""
    caixa(partes, nome + "_palma", palma, dim_palma, M_LUVA, 0.008, rot=rot)
    for i, (c, d) in enumerate(dedos):
        caixa(partes, f"{nome}_dedo{i}", c, d, M_LUVA, 0.004, rot=rot)
    caixa(partes, nome + "_polegar", polegar[0], polegar[1], M_LUVA, 0.004, rot=polegar[2])
    cilindro(partes, nome + "_antebraco", antebraco_de, antebraco_ate, 0.023, 0.029, M_MANGA, 10)
    # punho da luva
    a, b = Vector(antebraco_de), Vector(antebraco_ate)
    cilindro(partes, nome + "_punho", a, a + (b - a).normalized() * 0.035, 0.026, 0.026, M_LUVA, 10)


def maos_fuzil():
    p = []
    # direita na empunhadura
    mao(p, "d", (0.004, -0.012, -0.040), (0.050, 0.062, 0.082), (-16, 0, 0),
        [((0.004, 0.026 + 0.0, -0.022 - 0.014 * k), (0.046, 0.016, 0.018)) for k in range(4)],
        ((-0.020, -0.008, -0.020), (0.014, 0.040, 0.020), (0, 0, 10)),
        (0.004, -0.045, -0.050), (0.050, -0.30, -0.19))
    # esquerda no guarda-mão
    mao(p, "e", (-0.002, 0.372, 0.020), (0.052, 0.070, 0.050), (0, 0, 0),
        [((0.030, 0.372 - 0.016 * k + 0.012, 0.030), (0.016, 0.014, 0.040)) for k in range(4)],
        ((-0.028, 0.405, 0.050), (0.014, 0.040, 0.022), (0, 0, -15)),
        (-0.004, 0.325, 0.005), (-0.18, 0.02, -0.14))
    return p


def maos_pistola():
    p = []
    mao(p, "d", (0.002, -0.014, -0.040), (0.048, 0.060, 0.078), (-14, 0, 0),
        [((0.003, 0.024, -0.020 - 0.014 * k), (0.042, 0.014, 0.018)) for k in range(3)],
        ((-0.018, 0.004, 0.0), (0.014, 0.040, 0.020), (0, 0, 8)),
        (0.004, -0.045, -0.048), (0.060, -0.27, -0.20))
    mao(p, "e", (-0.034, -0.004, -0.045), (0.034, 0.058, 0.070), (-14, 0, 0),
        [((-0.050, 0.020, -0.028 - 0.014 * k), (0.016, 0.014, 0.018)) for k in range(3)],
        ((-0.030, 0.030, -0.005), (0.012, 0.036, 0.018), (0, 0, 10)),
        (-0.036, -0.035, -0.060), (-0.12, -0.26, -0.21))
    return p


def maos_granada():
    p = []
    mao(p, "d", (0.0, 0.100, -0.014), (0.068, 0.068, 0.058), (0, 0, 0),
        [((0.0, 0.130 + 0.0, -0.018 + 0.014 * k - 0.014), (0.060, 0.014, 0.016)) for k in range(4)],
        ((0.034, 0.098, 0.032), (0.016, 0.044, 0.020), (0, 0, 20)),
        (0.004, 0.060, -0.045), (0.050, -0.21, -0.20))
    return p


def juntar(partes, nome):
    ativar(partes[0])
    for o in partes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = partes[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = nome
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(45))
    except Exception:
        pass
    return obj


def assar(obj, nome, tam):
    """desdobra, assa os materiais numa imagem própria da arma e deixa um material só"""
    cena = bpy.context.scene
    ativar(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.006, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    img = bpy.data.images.new("textura_" + nome, tam, tam)
    for m in obj.data.materials:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = img
        m.node_tree.nodes.active = tex
    cena.render.engine = "CYCLES"
    cena.cycles.device = "CPU"
    cena.cycles.samples = 16 if RAPIDO else 48
    cena.render.bake.use_pass_direct = False
    cena.render.bake.use_pass_indirect = False
    cena.render.bake.use_pass_color = True
    cena.render.bake.margin = 6
    ativar(obj)
    bpy.ops.object.bake(type="DIFFUSE")
    img.update()
    tmp = os.path.join(tempfile.gettempdir(), f"_textura_{nome}.png")
    img.filepath_raw = tmp
    img.file_format = "PNG"
    img.save()
    final = bpy.data.materials.new(nome)
    final.use_nodes = True
    bsdf = [n for n in final.node_tree.nodes if n.type == "BSDF_PRINCIPLED"][0]
    tx = final.node_tree.nodes.new("ShaderNodeTexImage")
    cop = img.copy()
    tx.image = cop
    cop.pack()
    final.node_tree.links.new(tx.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Metallic"].default_value = 0.35
    obj.data.materials.clear()
    obj.data.materials.append(final)
    for p in obj.data.polygons:
        p.material_index = 0


tam = 512 if RAPIDO else 1024
armas = []
for nome, fabrica in [("fuzil", fuzil), ("pistola", pistola), ("granada", granada),
                      ("maos_fuzil", maos_fuzil), ("maos_pistola", maos_pistola), ("maos_granada", maos_granada)]:
    obj = juntar(fabrica(), nome)
    assar(obj, nome, tam if not nome.startswith("maos") else tam // 2)
    armas.append(obj)

bpy.ops.object.select_all(action="DESELECT")
for o in armas:
    o.select_set(True)
bpy.context.view_layer.objects.active = armas[0]
bpy.ops.export_scene.gltf(
    filepath=os.path.join(AQUI, "armas.glb"),
    export_format="GLB",
    use_selection=True,
    export_image_format="JPEG",
    export_jpeg_quality=90,
    export_apply=True,
)

# prévia: as três armas lado a lado e um close do fuzil
armas[0].location = (-0.55, 0, 0.9)
armas[1].location = (0.0, 0, 0.9)
armas[2].location = (0.45, 0, 0.9)
armas[3].location = (-0.55, 0, 0.9)  # as mãos ficam em cima da arma, como no jogo
armas[4].location = (0.0, 0, 0.9)
armas[5].location = (0.45, 0, 0.9)
preparar_foto(3)
foto("armas", AQUI, (0.6, -1.6, 1.25), (0.05, 0.12, 0.9), lente=55)
foto("armas_2", AQUI, (-0.55, -0.75, 1.12), (-0.55, 0.2, 0.9), lente=45)
foto("armas_3", AQUI, (0.0, -0.6, 1.05), (0.0, 0.0, 0.85), lente=45)
print("pronto")
