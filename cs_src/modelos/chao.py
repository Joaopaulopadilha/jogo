# Textura do chão da arena do CS Caps: asfalto rachado, terra, concreto, manchas de óleo e mato seco, sem repetição visível.
# Rodar:  blender --background --python chao.py [-- --rapido]
# Saída: ../public/texturas/chao.jpg (uma imagem só para a arena inteira, 64 x 64 m)

import math
import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u  # noqa: E402
from blender_util import RAPIDO, ativar, ligar, mistura, no, novo_material, novo_objeto, rampa  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.normpath(os.path.join(AQUI, "..", "public", "texturas", "chao.jpg"))
os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene

bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=32)  # 64 x 64 m
plano = novo_objeto("chao", bm)
ativar(plano)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=0.0)
bpy.ops.object.mode_set(mode="OBJECT")

m = novo_material("chao")
nt = m.node_tree
for n in list(nt.nodes):
    if n.type != "OUTPUT_MATERIAL":
        nt.nodes.remove(n)
saida = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
coord = no(m, "ShaderNodeTexCoord")


def ruido_n(escala, detalhe=8, rugosidade=0.55):
    n = no(m, "ShaderNodeTexNoise", noise_dimensions="3D")
    n.inputs["Scale"].default_value = escala
    n.inputs["Detail"].default_value = detalhe
    n.inputs["Roughness"].default_value = rugosidade
    ligar(m, coord, "Object", n, "Vector")
    return n


# camadas de material: asfalto, concreto, terra batida, mato seco
asfalto = rampa(m, (ruido_n(60, 6), "Fac"), [(0.35, (0.030, 0.030, 0.033, 1)), (0.70, (0.058, 0.057, 0.060, 1))])
concreto = rampa(m, (ruido_n(40, 6), "Fac"), [(0.35, (0.085, 0.082, 0.075, 1)), (0.70, (0.14, 0.135, 0.125, 1))])
terra = rampa(m, (ruido_n(50, 7), "Fac"), [(0.30, (0.045, 0.034, 0.024, 1)), (0.70, (0.098, 0.075, 0.052, 1))])
mato = rampa(m, (ruido_n(70, 6), "Fac"), [(0.30, (0.030, 0.038, 0.014, 1)), (0.70, (0.070, 0.082, 0.030, 1))])

# onde cada camada aparece: manchas grandes (~10 a 25 m)
m_terra = rampa(m, (ruido_n(0.09, 5), "Fac"), [(0.46, (0, 0, 0, 1)), (0.56, (1, 1, 1, 1))])
m_conc = rampa(m, (ruido_n(0.07, 4), "Fac"), [(0.54, (0, 0, 0, 1)), (0.62, (1, 1, 1, 1))])
m_mato = rampa(m, (ruido_n(0.14, 5), "Fac"), [(0.60, (0, 0, 0, 1)), (0.70, (1, 1, 1, 1))])
c1 = mistura(m, m_conc, "Color", asfalto, "Color", concreto, "Color")
c2 = mistura(m, m_terra, "Color", c1, "Result", terra, "Color")
c3 = mistura(m, m_mato, "Color", c2, "Result", mato, "Color")

# rachaduras: bordas de células (Voronoi) escurecem como fendas
vor = no(m, "ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="DISTANCE_TO_EDGE")
vor.inputs["Scale"].default_value = 0.30
ligar(m, coord, "Object", vor, "Vector")
fenda = rampa(m, (vor, "Distance"), [(0.0, (1, 1, 1, 1)), (0.020, (0, 0, 0, 1))])
vor2 = no(m, "ShaderNodeTexVoronoi", voronoi_dimensions="3D", feature="DISTANCE_TO_EDGE")
vor2.inputs["Scale"].default_value = 1.1
ligar(m, coord, "Object", vor2, "Vector")
fenda2 = rampa(m, (vor2, "Distance"), [(0.0, (0.5, 0.5, 0.5, 1)), (0.010, (0, 0, 0, 1))])
escuro = no(m, "ShaderNodeRGB")
escuro.outputs[0].default_value = (0.008, 0.008, 0.009, 1)
c4 = mistura(m, fenda, "Color", c3, "Result", escuro, "Color")
c5 = mistura(m, fenda2, "Color", c4, "Result", escuro, "Color")

# óleo e manchas escuras
m_oleo = rampa(m, (ruido_n(0.22, 4), "Fac"), [(0.66, (0, 0, 0, 1)), (0.76, (0.85, 0.85, 0.85, 1))])
oleo = no(m, "ShaderNodeRGB")
oleo.outputs[0].default_value = (0.012, 0.012, 0.014, 1)
c6 = mistura(m, m_oleo, "Color", c5, "Result", oleo, "Color")

bsdf = no(m, "ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = 1.0
ligar(m, c6, "Result", bsdf, "Base Color")
ligar(m, bsdf, "BSDF", saida, "Surface")
plano.data.materials.append(m)

tam = 1024 if RAPIDO else 2048
img = bpy.data.images.new("chao", tam, tam)
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = img
nt.nodes.active = tex
cena.render.engine = "CYCLES"
cena.cycles.device = "CPU"
cena.cycles.samples = 8
cena.render.bake.use_pass_direct = False
cena.render.bake.use_pass_indirect = False
cena.render.bake.use_pass_color = True
cena.render.bake.margin = 2
ativar(plano)
bpy.ops.object.bake(type="DIFFUSE")
img.update()
cena.render.image_settings.file_format = "JPEG"
cena.render.image_settings.quality = 88
img.save_render(SAIDA)
print("pronto", SAIDA)
