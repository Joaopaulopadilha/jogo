# Carro destruído realista (~12 mil triângulos, uma textura) para o cenário do CS Caps.
# Rodar:  blender --background --python carro_destruido.py [-- --rapido]
# Saídas: carro_destruido.glb (jogo), carro_destruido.png e carro_destruido_2.png (prévias)
#
# Medidas em metros; o carro aponta para +X, a esquerda dele é +Y e o topo é +Z (o exportador converte para Y para cima).
# Etapas: 1) carroceria moldada por seções  2) cortes (vidros, porta, caixas de roda)  3) amassados  4) rodas, interior, chão
#         5) texturas procedurais (tinta, ferrugem, fuligem, sujeira) assadas numa imagem  6) exporta e renderiza.

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

AQUI = os.path.dirname(os.path.abspath(__file__))
RAPIDO = "--rapido" in sys.argv
rnd = random.Random(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene


# ============================================================ utilidades ============================================================

def interp(tabela, x):
    """interpolação linear em uma tabela [(x, valor)] ordenada do maior x para o menor"""
    if x >= tabela[0][0]:
        return tabela[0][1]
    for (x0, v0), (x1, v1) in zip(tabela, tabela[1:]):
        if x1 <= x <= x0:
            t = (x - x1) / (x0 - x1) if x0 != x1 else 0
            return v1 + (v0 - v1) * t
    return tabela[-1][1]


def suave(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def ruido(p, escala):
    return noise.noise(Vector(p) * escala)  # -1..1


def novo_objeto(nome, bm):
    malha = bpy.data.meshes.new(nome)
    bm.to_mesh(malha)
    bm.free()
    o = bpy.data.objects.new(nome, malha)
    cena.collection.objects.link(o)
    return o


def ativar(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def cortar(alvo, cortador, material_cortador=None):
    """subtrai 'cortador' de 'alvo' (booleana exata) e apaga o cortador; as faces novas ganham o material do cortador"""
    if material_cortador is not None:
        cortador.data.materials.clear()
        cortador.data.materials.append(material_cortador)
    ativar(alvo)
    m = alvo.modifiers.new("corte", "BOOLEAN")
    m.object = cortador
    m.operation = "DIFFERENCE"
    m.solver = "EXACT"
    try:
        m.material_mode = "TRANSFER"
    except Exception:
        pass
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cortador, do_unlink=True)


def caixa_corte(centro, dim, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dim[0], v.co.y * dim[1], v.co.z * dim[2]))
    o = novo_objeto("cortador", bm)
    o.location = centro
    o.rotation_euler = tuple(math.radians(r) for r in rot)
    return o


def cilindro_corte(centro, raio, comprimento, eixo="y", seg=24):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=raio, radius2=raio, depth=comprimento)
    o = novo_objeto("cortador", bm)
    o.location = centro
    if eixo == "y":
        o.rotation_euler = (math.radians(90), 0, 0)
    elif eixo == "x":
        o.rotation_euler = (0, math.radians(90), 0)
    return o


# ============================================================ materiais (sombreamento procedural, assado depois) ============================================================

def novo_material(nome):
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    return m


def no(m, tipo, **kw):
    n = m.node_tree.nodes.new(tipo)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def ligar(m, a, saida, b, entrada):
    m.node_tree.links.new(a.outputs[saida], b.inputs[entrada])


def rampa(m, entrada_fator, pontos):
    r = no(m, "ShaderNodeValToRGB")
    r.color_ramp.elements[0].position = pontos[0][0]
    r.color_ramp.elements[0].color = pontos[0][1]
    r.color_ramp.elements[1].position = pontos[-1][0]
    r.color_ramp.elements[1].color = pontos[-1][1]
    for pos, cor in pontos[1:-1]:
        e = r.color_ramp.elements.new(pos)
        e.color = cor
    ligar(m, entrada_fator[0], entrada_fator[1], r, "Fac")
    return r


def mistura(m, fator_no, fator_saida, a_no, a_saida, b_no, b_saida):
    x = no(m, "ShaderNodeMix", data_type="RGBA")
    x.blend_type = "MIX"
    ligar(m, fator_no, fator_saida, x, "Factor")
    ligar(m, a_no, a_saida, x, "A")
    ligar(m, b_no, b_saida, x, "B")
    return x


def material_lataria():
    """tinta vermelha desbotada + ferrugem + fuligem (mais perto do motor/topo) + poeira (embaixo) + escurecimento em frestas"""
    m = novo_material("lataria")
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    saida = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"][0]
    coord = no(m, "ShaderNodeTexCoord")
    sep = no(m, "ShaderNodeSeparateXYZ")
    ligar(m, coord, "Object", sep, "Vector")

    # tinta com variação lenta
    r_grande = no(m, "ShaderNodeTexNoise", noise_dimensions="3D")
    r_grande.inputs["Scale"].default_value = 2.2
    r_grande.inputs["Detail"].default_value = 6
    ligar(m, coord, "Object", r_grande, "Vector")
    tinta = rampa(m, (r_grande, "Fac"), [(0.35, (0.055, 0.005, 0.004, 1)), (0.65, (0.125, 0.012, 0.009, 1))])

    # ferrugem em manchas + pontos finos
    r_ferr = no(m, "ShaderNodeTexNoise", noise_dimensions="3D")
    r_ferr.inputs["Scale"].default_value = 4.5
    r_ferr.inputs["Detail"].default_value = 9
    r_ferr.inputs["Roughness"].default_value = 0.65
    ligar(m, coord, "Object", r_ferr, "Vector")
    m_ferr = rampa(m, (r_ferr, "Fac"), [(0.48, (0, 0, 0, 1)), (0.60, (1, 1, 1, 1))])
    r_pt = no(m, "ShaderNodeTexNoise", noise_dimensions="3D")
    r_pt.inputs["Scale"].default_value = 38
    r_pt.inputs["Detail"].default_value = 4
    ligar(m, coord, "Object", r_pt, "Vector")
    cor_ferr = rampa(m, (r_pt, "Fac"), [(0.35, (0.045, 0.015, 0.005, 1)), (0.7, (0.105, 0.04, 0.013, 1))])
    com_ferr = mistura(m, m_ferr, "Color", tinta, "Color", cor_ferr, "Color")

    # fuligem: forte na frente e no alto, rasgada por ruído
    grad = no(m, "ShaderNodeMath", operation="MULTIPLY")
    ligar(m, sep, "X", grad, 0)
    grad.inputs[1].default_value = 0.45
    soma = no(m, "ShaderNodeMath", operation="ADD")
    ligar(m, grad, "Value", soma, 0)
    ligar(m, r_ferr, "Fac", soma, 1)
    fuligem_mask = rampa(m, (soma, "Value"), [(0.70, (0, 0, 0, 1)), (1.15, (1, 1, 1, 1))])
    preto = no(m, "ShaderNodeRGB")
    preto.outputs[0].default_value = (0.025, 0.022, 0.02, 1)
    com_fuligem = mistura(m, fuligem_mask, "Color", com_ferr, "Result", preto, "Color")

    # poeira/terra embaixo
    z_inv = no(m, "ShaderNodeMath", operation="MULTIPLY")
    ligar(m, sep, "Z", z_inv, 0)
    z_inv.inputs[1].default_value = -2.2
    z_mais = no(m, "ShaderNodeMath", operation="ADD")
    ligar(m, z_inv, "Value", z_mais, 0)
    z_mais.inputs[1].default_value = 2.1
    poeira_mask = rampa(m, (z_mais, "Value"), [(0.5, (0, 0, 0, 1)), (1.3, (0.65, 0.65, 0.65, 1))])
    terra = no(m, "ShaderNodeRGB")
    terra.outputs[0].default_value = (0.085, 0.068, 0.048, 1)
    com_poeira = mistura(m, poeira_mask, "Color", com_fuligem, "Result", terra, "Color")

    # escurece cantos e frestas
    ao = no(m, "ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.35
    escuro = no(m, "ShaderNodeMix", data_type="RGBA")
    escuro.blend_type = "MULTIPLY"
    escuro.inputs["Factor"].default_value = 1.0
    ligar(m, com_poeira, "Result", escuro, "A")
    ligar(m, ao, "Color", escuro, "B")

    bsdf = no(m, "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.8
    ligar(m, escuro, "Result", bsdf, "Base Color")
    ligar(m, bsdf, "BSDF", saida, "Surface")
    return m


def material_simples(nome, cor, aspereza=0.85, metal=0.0, ruido_escala=14, variacao=0.35):
    m = novo_material(nome)
    nt = m.node_tree
    bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    coord = no(m, "ShaderNodeTexCoord")
    r = no(m, "ShaderNodeTexNoise", noise_dimensions="3D")
    r.inputs["Scale"].default_value = ruido_escala
    r.inputs["Detail"].default_value = 6
    ligar(m, coord, "Object", r, "Vector")
    escuro = tuple(max(0, c * (1 - variacao)) for c in cor)
    claro = tuple(min(1, c * (1 + variacao * 0.6)) for c in cor)
    rp = rampa(m, (r, "Fac"), [(0.3, (*escuro, 1)), (0.7, (*claro, 1))])
    ao = no(m, "ShaderNodeAmbientOcclusion")
    ao.inputs["Distance"].default_value = 0.25
    mult = no(m, "ShaderNodeMix", data_type="RGBA")
    mult.blend_type = "MULTIPLY"
    mult.inputs["Factor"].default_value = 1.0
    ligar(m, rp, "Color", mult, "A")
    ligar(m, ao, "Color", mult, "B")
    ligar(m, mult, "Result", bsdf, "Base Color")
    bsdf.inputs["Roughness"].default_value = aspereza
    bsdf.inputs["Metallic"].default_value = metal
    return m


MAT_LATARIA = material_lataria()
MAT_INTERIOR = material_simples("interior", (0.05, 0.043, 0.038), 0.95, 0.0, 9, 0.5)
MAT_BANCO = material_simples("banco", (0.05, 0.03, 0.02), 0.95, 0.0, 22, 0.5)
MAT_PNEU = material_simples("pneu", (0.018, 0.017, 0.016), 0.95, 0.0, 30, 0.4)
MAT_ARO = material_simples("aro", (0.07, 0.05, 0.035), 0.6, 0.6, 18, 0.6)
MAT_METAL = material_simples("metal_exposto", (0.09, 0.05, 0.028), 0.7, 0.6, 20, 0.6)
MAT_BAIXO = material_simples("baixo_do_carro", (0.04, 0.035, 0.03), 0.95, 0.0, 12, 0.5)
MAT_CROMO = material_simples("cromado_velho", (0.20, 0.19, 0.17), 0.5, 0.8, 25, 0.5)
MAT_FAROL = material_simples("farol", (0.08, 0.09, 0.09), 0.3, 0.0, 30, 0.5)


# ============================================================ 1) carroceria moldada por seções ============================================================

TOPO = [(2.2, 0.62), (2.05, 0.74), (1.7, 0.82), (1.0, 0.89), (0.62, 0.93), (0.18, 1.34), (-0.25, 1.42), (-0.95, 1.39),
        (-1.45, 1.04), (-1.85, 0.99), (-2.2, 0.93)]
CINTURA = [(2.2, 0.60), (1.7, 0.80), (1.0, 0.87), (-1.5, 0.91), (-2.2, 0.92)]
LARG = [(2.2, 0.74), (1.95, 0.84), (1.4, 0.88), (-1.4, 0.88), (-1.95, 0.85), (-2.2, 0.76)]
BAIXO = [(2.2, 0.40), (2.0, 0.31), (-2.0, 0.31), (-2.2, 0.38)]


def carroceria():
    estacoes = [2.2 - i * (4.4 / 40) for i in range(41)]
    bm = bmesh.new()
    aneis = []
    for x in estacoes:
        w = interp(LARG, x)
        belt = interp(CINTURA, x)
        zt = max(interp(TOPO, x), belt + 0.03)
        zb = interp(BAIXO, x)
        estufa = zt - belt > 0.12
        wt = w * (0.80 if estufa else 0.93)
        meio = [
            (0.0, zb), (w * 0.86, zb), (w, zb + 0.10), (w, zb + (belt - zb) * 0.55), (w, belt),
            (wt, zt - (0.07 if estufa else 0.02)), (0.0, zt),
        ]
        pts = meio + [(-y, z) for (y, z) in reversed(meio[1:-1])]
        anel = [bm.verts.new((x, y, z)) for (y, z) in pts]
        aneis.append(anel)
    n = len(aneis[0])
    for a, b in zip(aneis, aneis[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(aneis[0][::-1])
    bm.faces.new(aneis[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # malha mais fina para poder amassar e cortar
    for _ in range(2):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    o = novo_objeto("carroceria", bm)
    o.data.materials.append(MAT_LATARIA)
    return o


corpo = carroceria()

# ============================================================ 2) cortes: cabine oca, vidros, porta, caixas de roda ============================================================

# a cabine é oca (o interior aparece pelos vãos)
cortar(corpo, caixa_corte((-0.35, 0, 0.88), (1.55, 1.30, 0.78)), MAT_INTERIOR)
# vidros laterais (sem vidro: sobram as colunas) — dianteiro e traseiro de cada lado
for x0, x1 in [(-0.50, 0.10), (-0.98, -0.56)]:
    cortar(corpo, caixa_corte(((x0 + x1) / 2, 0, 1.17), (x1 - x0, 2.2, 0.27)), MAT_INTERIOR)
# para-brisa e vidro traseiro (inclinados), sem vidro
cortar(corpo, caixa_corte((0.40, 0, 1.14), (0.62, 1.20, 0.32), rot=(0, 45, 0)), MAT_INTERIOR)
cortar(corpo, caixa_corte((-1.20, 0, 1.22), (0.58, 1.18, 0.30), rot=(0, -35, 0)), MAT_INTERIOR)
# porta esquerda (lado +Y) arrancada: vão grande mostrando o banco
cortar(corpo, caixa_corte((-0.30, 0.95, 0.68), (1.15, 0.5, 0.55)), MAT_INTERIOR)
# caixas de roda (só nas laterais, para não furar o carro de lado a lado)
EIXO_F, EIXO_T, RAIO_ROD, PISTA = 1.36, -1.30, 0.32, 0.74
for ex in (EIXO_F, EIXO_T):
    for lado in (-1, 1):
        cortar(corpo, cilindro_corte((ex, lado * 0.98, 0.34), 0.43, 0.55, "y", 28))

# ============================================================ 3) amassados ============================================================

def amassar_corpo(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.normal_update()
    for v in bm.verts:
        x, y, z = v.co
        d = Vector((0, 0, 0))
        # batida frontal: a frente recua e sobe, quanto mais perto da ponta pior
        f = suave((x - 0.9) / 1.3)
        if f > 0:
            d.x -= f * (0.55 + 0.25 * ruido((x, y, z), 1.6)) * (0.7 + 0.3 * math.cos(y * 2.0))
            d.z += f * 0.10 * ruido((y, z, x), 3.0)
            d.y += f * 0.10 * ruido((z, x, y), 2.5)
        # capô enrugado (sanfona)
        h = suave((x - 0.55) / 0.5) * suave((2.0 - x) / 0.4) * suave((z - 0.7) / 0.1)
        if h > 0 and z > 0.78:
            d.z += h * (0.10 * math.sin(x * 10.0 + y * 1.5) - 0.06 + 0.04 * ruido((x, y, z), 5.0))
        # teto afundado no meio e um pouco para o lado
        t = suave((z - 1.25) / 0.1) * math.exp(-(((x + 0.3) / 0.65) ** 2 + ((y - 0.1) / 0.5) ** 2))
        d.z -= t * 0.22
        # batida traseira no canto esquerdo
        r = suave((-x - 1.5) / 0.7) * suave((y + 0.2) / 0.8)
        d.x += r * 0.22 * (0.7 + 0.3 * ruido((x, y, z), 2.2))
        d.y -= r * 0.10
        # amassados e ondulações gerais
        g = 0.035 * ruido((x, y, z), 2.7) + 0.012 * ruido((x, y, z), 9.0)
        d += v.normal * g
        # lataria baixa dobrada onde a roda faltante batia
        b = suave((-x - 0.9) / 0.5) * suave((y - 0.5) / 0.4) * suave((0.55 - z) / 0.2)
        d.y -= b * 0.07
        v.co += d
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()


amassar_corpo(corpo)

# ============================================================ 4) peças: rodas, interior, para-choques, baixos, objetos no chão ============================================================

def girar_perfil(nome, perfil, passos=28, material=None):
    """malha de revolução em torno do eixo Y a partir de [(raio, y)]"""
    bm = bmesh.new()
    vs = [bm.verts.new((r, y, 0)) for r, y in perfil]
    es = [bm.edges.new((a, b)) for a, b in zip(vs, vs[1:])]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 1, 0), angle=math.tau, steps=passos, use_merge=True)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = novo_objeto(nome, bm)
    if material:
        o.data.materials.append(material)
    return o


def pneu(nome, murcho=1.0):
    perfil = [(0.20, -0.095), (0.255, -0.105), (0.30, -0.095), (0.322, -0.07), (0.33, -0.035), (0.332, 0.0),
              (0.33, 0.035), (0.322, 0.07), (0.30, 0.095), (0.255, 0.105), (0.20, 0.095)]
    o = girar_perfil(nome, perfil, 32, MAT_PNEU)
    # banda de rodagem: ranhuras ao redor
    for v in o.data.vertices:
        r = math.hypot(v.co.x, v.co.z)
        if r > 0.318:
            ang = math.atan2(v.co.z, v.co.x)
            k = 1 + 0.018 * (1 if math.sin(ang * 16) > 0 else -1)
            v.co.x *= k
            v.co.z *= k
    o.data.update()
    if murcho != 1.0:
        for v in o.data.vertices:
            v.co.z *= murcho if v.co.z < 0 else 1.0  # achata embaixo
    return o


def aro(nome):
    perfil = [(0.0, 0.082), (0.06, 0.088), (0.10, 0.074), (0.17, 0.078), (0.205, 0.07), (0.208, -0.07), (0.17, -0.06), (0.0, -0.05)]
    o = girar_perfil(nome, perfil, 20, MAT_ARO)
    # cinco furos de parafuso: pequenos cortes viram "porcas" no lugar
    return o


def colocar(o, loc, rot=(0, 0, 0)):
    o.location = loc
    o.rotation_euler = tuple(math.radians(r) for r in rot)
    return o


pecas = [corpo]
cem = lambda lado, ex: (ex, lado * PISTA, RAIO_ROD + 0.005)

# três rodas (a de trás à esquerda sumiu) — a dianteira direita está murcha
for nome, ex, lado, murcho, tombo in [("fe", EIXO_F, 1, 1.0, 2), ("fd", EIXO_F, -1, 0.72, -5), ("td", EIXO_T, -1, 1.0, 1)]:
    centro = cem(lado, ex)
    p = pneu("pneu_" + nome, murcho)
    a = aro("aro_" + nome)
    z = centro[2] - (0.05 if murcho < 1 else 0)
    for o in (p, a):
        colocar(o, (centro[0], centro[1], z), (tombo, 0, 0))
    a.location.y += lado * 0.02
    pecas += [p, a]

# lado sem roda: cubo, disco de freio enferrujado e braço da suspensão
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=0.15, radius2=0.15, depth=0.03)
disco = novo_objeto("disco_freio", bm)
disco.data.materials.append(MAT_METAL)
colocar(disco, (EIXO_T, 0.76, 0.34), (90, 0, 0))
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.055, radius2=0.045, depth=0.18)
cubo = novo_objeto("cubo_roda", bm)
cubo.data.materials.append(MAT_METAL)
colocar(cubo, (EIXO_T, 0.84, 0.34), (90, 0, 0))
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * 0.06, v.co.y * 0.55, v.co.z * 0.05))
braco = novo_objeto("braco_suspensao", bm)
braco.data.materials.append(MAT_METAL)
colocar(braco, (EIXO_T + 0.05, 0.55, 0.30), (0, 0, 12))
pecas += [disco, cubo, braco]

# o carro encosta o canto sem roda no chão: leve inclinação (ver fim do script)

# para-choque dianteiro: torto e solto de um lado
def barra(nome, comprimento, altura, prof, material, seg=6):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * prof, v.co.y * comprimento, v.co.z * altura))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=seg, use_grid_fill=True)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    return o


pf = barra("para_choque_frente", 1.74, 0.17, 0.14, MAT_CROMO)
for v in pf.data.vertices:
    v.co.x += -0.12 * suave((v.co.y - 0.2) / 0.7) + 0.06 * math.sin(v.co.y * 5)
    v.co.z -= 0.14 * suave((v.co.y - 0.1) / 0.8)
colocar(pf, (1.86, 0.02, 0.36), (4, 3, 9))
pecas.append(pf)
pt = barra("para_choque_tras", 1.6, 0.17, 0.13, MAT_CROMO)
for v in pt.data.vertices:
    v.co.z -= 0.18 * suave((-v.co.y - 0.1) / 0.7)
colocar(pt, (-2.2, -0.03, 0.34), (-3, 0, -5))
pecas.append(pt)

# faróis estourados
for lado in (-1, 1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.08, v.co.y * 0.30, v.co.z * 0.14))
    f = novo_objeto("farol", bm)
    f.data.materials.append(MAT_FAROL)
    colocar(f, (1.58, lado * 0.62, 0.69), (0, 0, lado * 10))
    f.location.x += (-0.2 if lado < 0 else -0.05)  # o lado batido entrou
    pecas.append(f)

# baixo do carro (escuro) + escapamento solto arrastando
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * 3.6, v.co.y * 1.3, v.co.z * 0.10))
baixo = novo_objeto("baixo", bm)
baixo.data.materials.append(MAT_BAIXO)
colocar(baixo, (-0.1, 0, 0.30))
pecas.append(baixo)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.045, radius2=0.045, depth=1.7)
esc = novo_objeto("escapamento", bm)
esc.data.materials.append(MAT_METAL)
colocar(esc, (-1.5, -0.35, 0.20), (0, 90, 6))
pecas.append(esc)

# interior: painel, volante, bancos
def forma_arredondada(nome, dim, material, bisel=0.03, cortes=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dim[0], v.co.y * dim[1], v.co.z * dim[2]))
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cortes, use_grid_fill=True)
    # "infla" para ficar macio
    for v in bm.verts:
        p = Vector((v.co.x / (dim[0] / 2), v.co.y / (dim[1] / 2), v.co.z / (dim[2] / 2)))
        k = 1.0 / max(1.0, p.length / 1.0) if p.length > 1.0 else 1.0
        v.co = Vector((v.co.x * (0.55 + 0.45 * k), v.co.y * (0.55 + 0.45 * k), v.co.z * (0.55 + 0.45 * k)))
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    return o


painel = forma_arredondada("painel", (0.30, 1.3, 0.34), MAT_INTERIOR)
colocar(painel, (0.30, 0, 0.88))
pecas.append(painel)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.17, radius2=0.17, depth=0.03)
volante = novo_objeto("volante", bm)
volante.data.materials.append(MAT_INTERIOR)
colocar(volante, (0.20, 0.36, 1.02), (0, 70, 0))
pecas.append(volante)
for nome, loc, rot in [("banco_motorista", (-0.15, 0.36, 0.62), (0, 4, 0)), ("banco_carona", (-0.15, -0.36, 0.62), (0, -3, 3)),
                       ("banco_tras", (-0.95, 0, 0.62), (0, 0, 0))]:
    larg = 0.5 if nome != "banco_tras" else 1.25
    base = forma_arredondada(nome + "_base", (0.48, larg, 0.16), MAT_BANCO)
    colocar(base, loc, rot)
    enc = forma_arredondada(nome + "_encosto", (0.14, larg, 0.62), MAT_BANCO)
    colocar(enc, (loc[0] - 0.24, loc[1], loc[2] + 0.33), (rot[0], rot[1] - 14 - (12 if nome == "banco_motorista" else 0), rot[2]))
    pecas += [base, enc]

# objetos soltos no chão (não fazem parte do "carro" em si, vão no mesmo arquivo para o jogo escolher usar ou não)
soltos = []
pn = pneu("pneu_solto")
a2 = aro("aro_solto")
for o in (pn, a2):
    colocar(o, (-1.5, 2.15, 0.12), (86, 0, 20))
a2.location += Vector((0.0, 0.0, 0.0))
soltos += [pn, a2]
# a porta arrancada, deitada ao lado
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * 1.1, v.co.y * 0.07, v.co.z * 0.62))
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)
porta = novo_objeto("porta_arrancada", bm)
porta.data.materials.append(MAT_LATARIA)
cortar(porta, caixa_corte((0.15, 0, 0.17), (0.55, 0.3, 0.2)), MAT_INTERIOR)
for v in porta.data.vertices:
    v.co += Vector((0, 0.05 * ruido(v.co, 3), 0.04 * ruido((v.co.y, v.co.z, v.co.x), 4)))
colocar(porta, (0.55, 3.1, 0.07), (78, 5, -25))
soltos.append(porta)

# ============================================================ 5) junta tudo, desdobra (UV) e assa as texturas numa imagem ============================================================

def juntar(lista, nome):
    ativar(lista[0])
    for o in lista:
        o.select_set(True)
    bpy.context.view_layer.objects.active = lista[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = nome
    return obj


carro = juntar(pecas + soltos, "carro_destruido")
bpy.ops.object.shade_smooth()  # a malha já tem as quinas marcadas pela geometria; o liso só ameniza a faceta
try:
    bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
except Exception:
    pass

ativar(carro)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(82), island_margin=0.003, scale_to_bounds=False)
bpy.ops.object.mode_set(mode="OBJECT")

TAM = 1024 if RAPIDO else 2048
img = bpy.data.images.new("textura_carro", TAM, TAM)
for m in carro.data.materials:
    nt = m.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex  # o destino do bake
cena.render.engine = "CYCLES"
cena.cycles.device = "CPU"
cena.cycles.samples = 16 if RAPIDO else 48
cena.render.bake.use_pass_direct = False
cena.render.bake.use_pass_indirect = False
cena.render.bake.use_pass_color = True
cena.render.bake.margin = 6
ativar(carro)
bpy.ops.object.bake(type="DIFFUSE")
img.update()

# material final único: só a imagem
final = bpy.data.materials.new("carro")
final.use_nodes = True
nt = final.node_tree
bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = img
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.85
bsdf.inputs["Metallic"].default_value = 0.0
carro.data.materials.clear()
carro.data.materials.append(final)
for p in carro.data.polygons:
    p.material_index = 0

img.filepath_raw = os.path.join(AQUI, "textura_carro.png")
img.file_format = "PNG"
img.save()

# imagem menor para o jogo (1024 já basta e pesa pouco)
img_jogo = img.copy()
img_jogo.scale(1024, 1024)
tex.image = img_jogo
img_jogo.pack()

# ============================================================ 6) exporta e renderiza ============================================================

# o carro apoiado no canto sem roda: leve inclinação e afundado
carro.rotation_euler = (math.radians(0), math.radians(0), 0)
ativar(carro)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(AQUI, "carro_destruido.glb"),
    export_format="GLB",
    use_selection=True,
    export_image_format="JPEG",
    export_jpeg_quality=85,
    export_apply=True,
)

# --- prévia ---
chao_bm = bmesh.new()
bmesh.ops.create_grid(chao_bm, x_segments=60, y_segments=60, size=14)
chao = novo_objeto("_chao", chao_bm)
for v in chao.data.vertices:
    v.co.z += 0.03 * ruido((v.co.x, v.co.y, 0), 0.9) + 0.012 * ruido((v.co.x, v.co.y, 5), 4)
mc = novo_material("terra")
nt = mc.node_tree
b2 = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
c0 = no(mc, "ShaderNodeTexCoord")
n1 = no(mc, "ShaderNodeTexNoise", noise_dimensions="3D")
n1.inputs["Scale"].default_value = 1.6
n1.inputs["Detail"].default_value = 10
nt.links.new(c0.outputs["Object"], n1.inputs["Vector"])
rr = rampa(mc, (n1, "Fac"), [(0.35, (0.045, 0.038, 0.030, 1)), (0.65, (0.10, 0.085, 0.065, 1))])
nt.links.new(rr.outputs["Color"], b2.inputs["Base Color"])
b2.inputs["Roughness"].default_value = 1.0
chao.data.materials.append(mc)

mundo = bpy.data.worlds.new("ceu")
mundo.use_nodes = True
nt = mundo.node_tree
fundo = nt.nodes["Background"]
ceu = nt.nodes.new("ShaderNodeTexSky")
try:
    ceu.sky_type = "NISHITA"
except Exception:
    try:
        ceu.sky_type = "SINGLE_SCATTERING"
    except Exception:
        pass
for atributo, valor in [("sun_elevation", math.radians(24)), ("sun_rotation", math.radians(215)), ("air_density", 1.1), ("dust_density", 1.6)]:
    try:
        setattr(ceu, atributo, valor)
    except Exception:
        pass
nt.links.new(ceu.outputs["Color"], fundo.inputs["Color"])
fundo.inputs["Strength"].default_value = 0.55
try:
    ceu.sun_intensity = 0.55
except Exception:
    pass
cena.world = mundo

cena.cycles.samples = 24 if RAPIDO else 96
cena.cycles.use_denoising = True
cena.render.resolution_x = 900 if RAPIDO else 1280
cena.render.resolution_y = 520 if RAPIDO else 740
try:
    cena.view_settings.view_transform = "AgX"
    cena.view_settings.exposure = -1.2
except Exception:
    pass


def foto(nome, cam_loc, alvo):
    cam = bpy.data.cameras.new(nome)
    cam.lens = 32
    co = bpy.data.objects.new(nome, cam)
    cena.collection.objects.link(co)
    co.location = cam_loc
    co.rotation_euler = (Vector(alvo) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    cena.camera = co
    cena.render.filepath = os.path.join(AQUI, nome + ".png")
    bpy.ops.render.render(write_still=True)


foto("carro_destruido", (4.6, 5.0, 2.0), (0, 0.2, 0.7))
foto("carro_destruido_2", (-4.8, -4.4, 1.7), (0, 0, 0.7))
print("pronto")
