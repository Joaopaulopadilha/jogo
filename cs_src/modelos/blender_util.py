# Funções comuns dos modelos do CS Caps (usadas pelos scripts de cada objeto; rodar sempre dentro do Blender).
# Malha por seções, cortes booleanos, materiais procedurais, assar numa textura, exportar .glb e fotografar.

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

RAPIDO = "--rapido" in sys.argv


def cena():
    return bpy.context.scene


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
    cena().collection.objects.link(o)
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


# ---------------------------------------------------------------- materiais ----

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


# ---------------------------------------------------------------- peças comuns ----

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


def pneu(nome, material, escala=1.0, largura=1.0, murcho=1.0, passos=28, ranhuras=16):
    perfil = [(0.20, -0.095), (0.255, -0.105), (0.30, -0.095), (0.322, -0.07), (0.33, -0.035), (0.332, 0.0),
              (0.33, 0.035), (0.322, 0.07), (0.30, 0.095), (0.255, 0.105), (0.20, 0.095)]
    perfil = [(r * escala, y * escala * largura) for r, y in perfil]
    o = girar_perfil(nome, perfil, passos, material)
    lim = 0.318 * escala
    for v in o.data.vertices:
        r = math.hypot(v.co.x, v.co.z)
        if r > lim:
            ang = math.atan2(v.co.z, v.co.x)
            k = 1 + 0.018 * (1 if math.sin(ang * ranhuras) > 0 else -1)
            v.co.x *= k
            v.co.z *= k
    if murcho != 1.0:
        for v in o.data.vertices:
            if v.co.z < 0:
                v.co.z *= murcho
    o.data.update()
    return o


def aro(nome, material, escala=1.0, largura=1.0, passos=20):
    perfil = [(0.0, 0.082), (0.06, 0.088), (0.10, 0.074), (0.17, 0.078), (0.205, 0.07), (0.208, -0.07), (0.17, -0.06), (0.0, -0.05)]
    perfil = [(r * escala, y * escala * largura) for r, y in perfil]
    return girar_perfil(nome, perfil, passos, material)


def colocar(o, loc, rot=(0, 0, 0)):
    o.location = loc
    o.rotation_euler = tuple(math.radians(r) for r in rot)
    return o


def caixa_malha(nome, dim, material, cortes=0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * dim[0], v.co.y * dim[1], v.co.z * dim[2]))
    if cortes:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cortes, use_grid_fill=True)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    return o


def cilindro_malha(nome, raio, comprimento, material, seg=14, raio2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=raio, radius2=raio if raio2 is None else raio2, depth=comprimento)
    o = novo_objeto(nome, bm)
    o.data.materials.append(material)
    return o


def juntar(lista, nome):
    ativar(lista[0])
    for o in lista:
        o.select_set(True)
    bpy.context.view_layer.objects.active = lista[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = nome
    return obj


# ---------------------------------------------------------------- textura, exportação, foto ----

def assar_e_exportar(obj, nome, pasta, angulo_uv=82):
    """desdobra, assa todos os materiais numa imagem, troca por um material só e exporta o .glb"""
    c = cena()
    ativar(obj)
    bpy.ops.object.shade_smooth()
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(40))
    except Exception:
        pass
    ativar(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angulo_uv), island_margin=0.003, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")

    tam = 1024 if RAPIDO else 2048
    img = bpy.data.images.new("textura_" + nome, tam, tam)
    for m in obj.data.materials:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = img
        m.node_tree.nodes.active = tex
    c.render.engine = "CYCLES"
    c.cycles.device = "CPU"
    c.cycles.samples = 16 if RAPIDO else 48
    c.render.bake.use_pass_direct = False
    c.render.bake.use_pass_indirect = False
    c.render.bake.use_pass_color = True
    c.render.bake.margin = 6
    ativar(obj)
    bpy.ops.object.bake(type="DIFFUSE")
    img.update()

    # salva a imagem assada num arquivo temporário: sem isso a cópia usada na exportação sai preta
    import tempfile
    tmp = os.path.join(tempfile.gettempdir(), "_textura_" + nome + ".png")
    img.filepath_raw = tmp
    img.file_format = "PNG"
    img.save()

    final = bpy.data.materials.new(nome)
    final.use_nodes = True
    nt = final.node_tree
    bsdf = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    tex = nt.nodes.new("ShaderNodeTexImage")
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    obj.data.materials.clear()
    obj.data.materials.append(final)
    for p in obj.data.polygons:
        p.material_index = 0
    img_jogo = img.copy()
    img_jogo.scale(1024, 1024)
    tex.image = img_jogo
    img_jogo.pack()

    ativar(obj)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(pasta, nome + ".glb"),
        export_format="GLB",
        use_selection=True,
        export_image_format="JPEG",
        export_jpeg_quality=85,
        export_apply=True,
    )


def preparar_foto(tamanho_chao=16):
    c = cena()
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=60, y_segments=60, size=tamanho_chao)
    chao = novo_objeto("_chao", bm)
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
    for atributo, valor in [("sun_elevation", math.radians(24)), ("sun_rotation", math.radians(215)), ("air_density", 1.1),
                            ("dust_density", 1.6), ("sun_intensity", 0.55)]:
        try:
            setattr(ceu, atributo, valor)
        except Exception:
            pass
    nt.links.new(ceu.outputs["Color"], fundo.inputs["Color"])
    fundo.inputs["Strength"].default_value = 0.55
    c.world = mundo
    c.cycles.samples = 24 if RAPIDO else 96
    c.cycles.use_denoising = True
    c.render.resolution_x = 900 if RAPIDO else 1280
    c.render.resolution_y = 520 if RAPIDO else 740
    try:
        c.view_settings.view_transform = "AgX"
        c.view_settings.exposure = -1.2
    except Exception:
        pass


def foto(nome, pasta, cam_loc, alvo, lente=32):
    c = cena()
    cam = bpy.data.cameras.new(nome)
    cam.lens = lente
    co = bpy.data.objects.new(nome, cam)
    c.collection.objects.link(co)
    co.location = cam_loc
    co.rotation_euler = (Vector(alvo) - Vector(cam_loc)).to_track_quat("-Z", "Y").to_euler()
    c.camera = co
    c.render.filepath = os.path.join(pasta, nome + ".png")
    bpy.ops.render.render(write_still=True)
