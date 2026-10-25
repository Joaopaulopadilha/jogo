# Blindado de transporte (8 rodas) semidestruído para o centro do mapa do CS Caps.
# Rodar:  blender --background --python blindado_semidestruido.py [-- --rapido]
# Saídas: blindado_semidestruido.glb (jogo), blindado_semidestruido.png e _2.png (prévias)
#
# Medidas em metros; o veículo aponta para +X (6,6 m de comprimento, 2,7 m de largura, 2,1 m do casco).
# Estragos: buraco de explosão no teto e na lateral direita, porta esquerda aberta, torre torta com o cano dobrado,
# roda dianteira esquerda faltando, pneu traseiro murcho, fuligem em volta dos buracos.

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u  # noqa: E402
from blender_util import (aro, assar_e_exportar, caixa_corte, caixa_malha, cilindro_corte, cilindro_malha, colocar, cortar, foto,
                          interp, juntar, ligar, material_simples, no, novo_material, novo_objeto, pneu, preparar_foto, rampa,
                          ruido, suave, mistura)  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)


# ============================================================ materiais ============================================================

def material_casco():
    """verde-oliva desbotado + ferrugem + fuligem forte em volta dos buracos + poeira embaixo"""
    m = novo_material("casco")
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    saida = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
    coord = no(m, "ShaderNodeTexCoord")
    sep = no(m, "ShaderNodeSeparateXYZ")
    ligar(m, coord, "Object", sep, "Vector")

    grande = no(m, "ShaderNodeTexNoise", noise_dimensions="3D")
    grande.inputs["Scale"].default_value = 1.8
    grande.inputs["Detail"].default_value = 6
    ligar(m, coord, "Object", grande, "Vector")
    tinta = rampa(m, (grande, "Fac"), [(0.35, (0.034, 0.066, 0.010, 1)), (0.65, (0.080, 0.145, 0.024, 1))])

    fer = no(m, "ShaderNodeTexNoise", noise_dimensions="3D")
    fer.inputs["Scale"].default_value = 4.0
    fer.inputs["Detail"].default_value = 9
    fer.inputs["Roughness"].default_value = 0.65
    ligar(m, coord, "Object", fer, "Vector")
    m_fer = rampa(m, (fer, "Fac"), [(0.55, (0, 0, 0, 1)), (0.66, (1, 1, 1, 1))])
    pt = no(m, "ShaderNodeTexNoise", noise_dimensions="3D")
    pt.inputs["Scale"].default_value = 30
    pt.inputs["Detail"].default_value = 4
    ligar(m, coord, "Object", pt, "Vector")
    cor_fer = rampa(m, (pt, "Fac"), [(0.35, (0.028, 0.010, 0.004, 1)), (0.7, (0.065, 0.024, 0.008, 1))])
    com_fer = mistura(m, m_fer, "Color", tinta, "Color", cor_fer, "Color")

    # fuligem: perto dos buracos (teto, lateral direita, torre) e no alto
    mascara = None
    for ponto, raio in [((-1.2, 0.0, 2.1), 1.2), ((0.9, -1.3, 1.35), 1.1), ((0.55, 0.0, 2.4), 0.9)]:
        dist = no(m, "ShaderNodeVectorMath", operation="DISTANCE")
        ligar(m, coord, "Object", dist, 0)
        dist.inputs[1].default_value = ponto
        ruidoso = no(m, "ShaderNodeMath", operation="ADD")
        ligar(m, dist, "Value", ruidoso, 0)
        ligar(m, fer, "Fac", ruidoso, 1)
        r = rampa(m, (ruidoso, "Value"), [(0.25, (1, 1, 1, 1)), (raio, (0, 0, 0, 1))])
        if mascara is None:
            mascara = r
        else:
            mx = no(m, "ShaderNodeMix", data_type="RGBA")
            mx.blend_type = "LIGHTEN"
            mx.inputs["Factor"].default_value = 1.0
            ligar(m, mascara, "Result" if mascara.type == "MIX" else "Color", mx, "A")
            ligar(m, r, "Color", mx, "B")
            mascara = mx
    preto = no(m, "ShaderNodeRGB")
    preto.outputs[0].default_value = (0.012, 0.011, 0.010, 1)
    if mascara.type == "MIX":
        com_fuligem = mistura(m, mascara, "Result", com_fer, "Result", preto, "Color")
    else:
        com_fuligem = mistura(m, mascara, "Color", com_fer, "Result", preto, "Color")

    # poeira embaixo
    z_inv = no(m, "ShaderNodeMath", operation="MULTIPLY")
    ligar(m, sep, "Z", z_inv, 0)
    z_inv.inputs[1].default_value = -1.6
    z_mais = no(m, "ShaderNodeMath", operation="ADD")
    ligar(m, z_inv, "Value", z_mais, 0)
    z_mais.inputs[1].default_value = 1.9
    poeira = rampa(m, (z_mais, "Value"), [(0.7, (0, 0, 0, 1)), (1.4, (0.55, 0.55, 0.55, 1))])
    terra = no(m, "ShaderNodeRGB")
    terra.outputs[0].default_value = (0.085, 0.068, 0.048, 1)
    com_poeira = mistura(m, poeira, "Color", com_fuligem, "Result", terra, "Color")

    ao = no(m, "ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.4
    esc = no(m, "ShaderNodeMix", data_type="RGBA")
    esc.blend_type = "MULTIPLY"
    esc.inputs["Factor"].default_value = 1.0
    ligar(m, com_poeira, "Result", esc, "A")
    ligar(m, ao, "Color", esc, "B")
    bsdf = no(m, "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.85
    ligar(m, esc, "Result", bsdf, "Base Color")
    ligar(m, bsdf, "BSDF", saida, "Surface")
    return m


MAT_CASCO = material_casco()
MAT_INTERIOR = material_simples("interior", (0.02, 0.018, 0.016), 0.95, 0.0, 8, 0.5)
MAT_BANCO = material_simples("banco", (0.03, 0.025, 0.018), 0.95, 0.0, 20, 0.5)
MAT_PNEU = material_simples("pneu", (0.03, 0.028, 0.026), 0.95, 0.0, 28, 0.4)
MAT_ARO = material_simples("aro", (0.06, 0.07, 0.035), 0.6, 0.5, 16, 0.6)
MAT_METAL = material_simples("metal", (0.06, 0.04, 0.025), 0.7, 0.6, 18, 0.6)
MAT_CANO = material_simples("cano", (0.02, 0.02, 0.02), 0.6, 0.7, 26, 0.5)
MAT_BAIXO = material_simples("baixo", (0.03, 0.026, 0.022), 0.95, 0.0, 10, 0.5)

# ============================================================ casco moldado por seções ============================================================

TOPO = [(3.3, 1.05), (2.9, 1.40), (2.2, 1.88), (1.4, 2.12), (-1.4, 2.12), (-2.3, 1.98), (-3.1, 1.85), (-3.3, 1.60)]
LARG = [(3.3, 0.95), (2.9, 1.15), (2.2, 1.28), (-2.9, 1.30), (-3.3, 1.10)]
BAIXO = [(3.3, 0.62), (3.0, 0.50), (-3.0, 0.50), (-3.3, 0.60)]


def casco():
    estacoes = [3.3 - i * (6.6 / 44) for i in range(45)]
    bm = bmesh.new()
    aneis = []
    for x in estacoes:
        w = interp(LARG, x)
        zt = interp(TOPO, x)
        zb = interp(BAIXO, x)
        zc = zb + 0.18
        zd = max(zc + 0.05, min(0.95, zt - 0.3))
        ze = max(zd + 0.05, min(1.55, zt - 0.12))
        zf = max(ze + 0.02, zt - 0.04)
        meio = [(0.0, zb), (w * 0.55, zb), (w * 0.92, zc), (w, zd), (w, ze), (w * 0.80, zf), (0.0, zt)]
        pts = meio + [(-y, z) for (y, z) in reversed(meio[1:-1])]
        aneis.append([bm.verts.new((x, y, z)) for (y, z) in pts])
    n = len(aneis[0])
    for a, b in zip(aneis, aneis[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(aneis[0][::-1])
    bm.faces.new(aneis[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    o = novo_objeto("casco", bm)
    o.data.materials.append(MAT_CASCO)
    return o


corpo = casco()

# interior oco: compartimento de tropa (atrás) e posto do motorista (frente)
cortar(corpo, caixa_corte((-1.0, 0, 1.38), (3.9, 2.0, 1.1)), MAT_INTERIOR)
cortar(corpo, caixa_corte((1.9, 0, 1.35), (1.5, 1.5, 0.8)), MAT_INTERIOR)
# buraco da explosão no teto (aberto para o compartimento) e escotilha do motorista arrancada
cortar(corpo, caixa_corte((-1.2, -0.1, 2.05), (1.7, 1.3, 0.5), rot=(0, 0, 9)), MAT_INTERIOR)
cortar(corpo, caixa_corte((1.9, 0.45, 1.95), (0.55, 0.55, 0.5)), MAT_INTERIOR)
# porta lateral esquerda aberta e rombo de explosão na lateral direita
cortar(corpo, caixa_corte((-0.1, 1.2, 1.25), (1.0, 0.9, 0.95)), MAT_INTERIOR)
cortar(corpo, cilindro_corte((0.9, -1.3, 1.35), 0.5, 0.8, "y", 14), MAT_INTERIOR)
# caixas de roda
EIXOS = [2.35, 0.95, -0.75, -2.30]
LADO_Y = 1.40
ESC = 1.6          # escala do pneu base (raio 0,332 -> 0,53 m)
RAIO_ROD = 0.332 * ESC
for ex in EIXOS:
    for lado in (-1, 1):
        cortar(corpo, cilindro_corte((ex, lado * 1.18, RAIO_ROD), 0.64, 0.55, "y", 24))

# ============================================================ estragos na chapa ============================================================

def amassar(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.normal_update()
    for v in bm.verts:
        x, y, z = v.co
        d = Vector((0, 0, 0))
        # nariz amassado e empurrado para trás
        f = suave((x - 2.4) / 0.9)
        d.x -= f * 0.22 * (0.6 + 0.4 * ruido((x, y, z), 2.0))
        d.z -= f * 0.06
        # bordas do buraco do teto reviradas para cima, como pétalas
        r = math.hypot((x + 1.2) / 1.0, (y + 0.1) / 0.8)
        if z > 1.8:
            petal = suave(1.0 - abs(r - 1.0) / 0.55)
            d.z += petal * (0.10 + 0.12 * (ruido((x, y, z), 4.0) + 1) * 0.5)
        # chapa em volta do rombo da lateral entra e rasga
        rl = math.hypot(x - 0.9, z - 1.35)
        if y < -1.0:
            d.y += suave(1.0 - rl / 1.1) * 0.10 * (0.5 + 0.5 * ruido((x, y, z), 5.0))
        # lateral esquerda ondulada, teto levemente afundado
        d += v.normal * (0.022 * ruido((x, y, z), 2.6) + 0.010 * ruido((x, y, z), 9.0))
        v.co += d
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()


amassar(corpo)

pecas = [corpo]

# ============================================================ torre, canhão, escotilhas, rodas, detalhes ============================================================

torre = cilindro_malha("torre", 0.74, 0.55, MAT_CASCO, seg=10, raio2=0.56)
torre.data.use_auto_texspace = True
for v in torre.data.vertices:
    v.co += Vector((0.05 * ruido(v.co, 3.0), 0.05 * ruido((v.co.y, v.co.z, v.co.x), 3.0), 0.03 * ruido((v.co.z, v.co.x, v.co.y), 3.0)))
cortar(torre, cilindro_corte((0.15, -0.3, 0.05), 0.2, 0.9, "y", 10), MAT_INTERIOR)  # furo de estilhaço na torre
colocar(torre, (0.55, 0.0, 2.40), (7, -5, 16))
pecas.append(torre)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.055, radius2=0.055, depth=2.0)
for v in bm.verts:
    t = (v.co.z + 1.0) / 2.0          # 0 na base, 1 na boca
    v.co.x += 0.0
    v.co.y += 0.20 * t * t            # cano dobrado para o lado
    v.co.x *= 1 + 0.5 * suave((t - 0.9) / 0.1)  # boca esgarçada
barril = novo_objeto("cano", bm)
barril.data.materials.append(MAT_CANO)
colocar(barril, (1.7, 0.1, 2.5), (0, 90 + 9, 14))
pecas.append(barril)

# tampa da escotilha caída no chão e uma antena entortada
tampa = caixa_malha("tampa_escotilha", (0.62, 0.62, 0.05), MAT_CASCO, cortes=2)
for v in tampa.data.vertices:
    v.co += Vector((0, 0, 0.03 * ruido(v.co, 6.0)))
colocar(tampa, (2.6, 2.4, 0.05), (4, 7, 31))
pecas.append(tampa)
ant = cilindro_malha("antena", 0.012, 1.8, MAT_CANO, seg=6)
colocar(ant, (-2.35, 0.75, 2.75), (28, 6, 12))
pecas.append(ant)

# rodas: oito, menos a dianteira esquerda; a traseira direita está murcha e a do meio direita meio solta
for ex in EIXOS:
    for lado in (-1, 1):
        if ex == EIXOS[0] and lado == 1:
            continue
        murcho = 0.62 if (ex == EIXOS[3] and lado == -1) else 1.0
        tombo = 13 if (ex == EIXOS[1] and lado == -1) else 0
        p = pneu(f"pneu_{ex}_{lado}", MAT_PNEU, ESC, 1.5, murcho, passos=22, ranhuras=14)
        a = aro(f"aro_{ex}_{lado}", MAT_ARO, ESC, 1.5, passos=14)
        z = RAIO_ROD - (0.09 if murcho < 1 else 0.0)
        for o in (p, a):
            colocar(o, (ex, lado * LADO_Y, z), (tombo, 0, 0))
        pecas += [p, a]

# sem a roda dianteira esquerda: cubo, disco de freio e braço de suspensão
disco = cilindro_malha("disco", 0.28, 0.05, MAT_METAL, seg=16)
colocar(disco, (EIXOS[0], 1.18, RAIO_ROD), (90, 0, 0))
cubo = cilindro_malha("cubo", 0.1, 0.3, MAT_METAL, seg=10)
colocar(cubo, (EIXOS[0], 1.30, RAIO_ROD), (90, 0, 0))
braco = caixa_malha("braco", (0.14, 0.7, 0.10), MAT_METAL)
colocar(braco, (EIXOS[0] + 0.1, 1.0, 0.72), (0, 0, 8))
pecas += [disco, cubo, braco]

# lanternas e faixa de reboque na frente (uma arrancada)
farol = caixa_malha("farol", (0.14, 0.34, 0.22), MAT_METAL)
colocar(farol, (3.12, -0.78, 1.0), (0, 0, -12))
pecas.append(farol)
gancho = caixa_malha("gancho", (0.20, 0.10, 0.10), MAT_METAL)
colocar(gancho, (3.35, 0.0, 0.80), (0, 0, 0))
pecas.append(gancho)

# baixo do casco (escuro)
baixo = caixa_malha("baixo", (6.2, 2.2, 0.16), MAT_BAIXO)
colocar(baixo, (0, 0, 0.55))
pecas.append(baixo)

# interior: bancos laterais, caixa de munição e um pedaço de chapa solto
for lado in (-1, 1):
    b = caixa_malha(f"banco_{lado}", (2.6, 0.38, 0.38), MAT_BANCO, cortes=1)
    colocar(b, (-1.0, lado * 0.72, 0.98), (0, 0, 0))
    pecas.append(b)
caixa = caixa_malha("caixa_municao", (0.55, 0.32, 0.30), MAT_METAL)
colocar(caixa, (-1.8, 0.1, 1.0), (4, 0, 25))
pecas.append(caixa)

# ============================================================ junta, assa, exporta e fotografa ============================================================

blindado = juntar(pecas, "blindado_semidestruido")
assar_e_exportar(blindado, "blindado_semidestruido", AQUI)

preparar_foto(20)
foto("blindado_semidestruido", AQUI, (9.5, 7.8, 3.6), (0, 0.0, 1.1), lente=30)
foto("blindado_semidestruido_2", AQUI, (-8.5, -7.8, 3.4), (0, 0.0, 1.1), lente=30)
print("pronto")
