# Inspeciona o modelo do Meshy (aventureiro lhama): malhas, triângulos, texturas, tamanho, fatias em x e fotos de frente/lado/costas.
# Rodar: blender --background --python inspecionar_lhama.py [-- --pasta=C:/onde/salvar]
import bpy, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_util as u

AQUI = os.path.dirname(os.path.abspath(__file__))
ORIGEM = os.path.normpath(os.path.join(AQUI, "..", "Meshy_AI_Llama_Adventurer_1102165911_texture.glb"))
PASTA = AQUI
for a in sys.argv:
    if a.startswith("--pasta="):
        PASTA = a.split("=", 1)[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ORIGEM)
for o in bpy.data.objects:
    print("OBJ", o.name, o.type, tuple(round(v, 3) for v in o.dimensions), "pai", o.parent.name if o.parent else "-")
    if o.type == "MESH":
        tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
        vs = o.data.vertices
        print("  tris", tris, "verts", len(vs), "mats", [m.name for m in o.data.materials])
        mw = o.matrix_world
        cs = [mw @ v.co for v in vs]
        print("  min", [round(min(c[i] for c in cs), 3) for i in range(3)], "max", [round(max(c[i] for c in cs), 3) for i in range(3)])
for im in bpy.data.images:
    print("IMG", im.name, im.size[:])
print("ANIM", [a.name for a in bpy.data.actions], "ARM", [o.name for o in bpy.data.objects if o.type == "ARMATURE"])

# fatias: trechos ocupados em x a cada 5 cm de altura (separa pernas, braços e tronco) e a profundidade em y
o = [x for x in bpy.data.objects if x.type == "MESH"][0]
mw = o.matrix_world
cs = [mw @ v.co for v in o.data.vertices]
zmin = min(c.z for c in cs)
zmax = max(c.z for c in cs)
alt = zmax - zmin
passo = alt / 40
for i in range(41):
    z = i * passo
    fatia = sorted(c.x for c in cs if abs((c.z - zmin) - z) < passo * 0.25)
    if not fatia:
        continue
    trechos = []
    ini = ant = fatia[0]
    for x in fatia[1:]:
        if x - ant > alt * 0.012:
            trechos.append((round(ini, 3), round(ant, 3)))
            ini = x
        ant = x
    trechos.append((round(ini, 3), round(ant, 3)))
    ys = [c.y for c in cs if abs((c.z - zmin) - z) < passo * 0.25]
    print("Z %.3f" % z, trechos, "y", round(min(ys), 3), round(max(ys), 3))

u.preparar_foto(5)
cz = (zmin + zmax) / 2
d = max(alt * 2.6, 4)
u.foto("lhama_frente", PASTA, (0, -d, cz), (0, 0, cz), lente=45)
u.foto("lhama_lado", PASTA, (d, 0, cz), (0, 0, cz), lente=45)
u.foto("lhama_costas", PASTA, (0, d, cz), (0, 0, cz), lente=45)
