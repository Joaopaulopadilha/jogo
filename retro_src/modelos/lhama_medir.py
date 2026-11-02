# Mede o aventureiro lhama já com os pés em z=0: fatias em x a cada 2 cm (separa pernas, braços, tronco e cabeça) + fotos de frente/lado/costas.
# Rodar: blender --background --python lhama_medir.py -- --pasta=C:/onde/salvar
import bpy, os, sys
from mathutils import Vector
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
o = [x for x in bpy.data.objects if x.type == "MESH"][0]
o.data.transform(o.matrix_world)
o.matrix_world.identity()
vs = o.data.vertices
zmin = min(v.co.z for v in vs)
zmax = max(v.co.z for v in vs)
pes = [v.co for v in vs if v.co.z < zmin + 0.03]
cy = sum(p.y for p in pes) / len(pes)
for v in vs:
    v.co = Vector((v.co.x, v.co.y - cy, v.co.z - zmin))
o.data.update()
alt = zmax - zmin
print("ALTURA original", round(alt, 4))
cs = [v.co.copy() for v in vs]
for i in range(0, 96):
    z = i * 0.02
    fatia = sorted(c.x for c in cs if abs(c.z - z) < 0.006)
    if not fatia:
        continue
    trechos = []
    ini = ant = fatia[0]
    for x in fatia[1:]:
        if x - ant > 0.02:
            trechos.append((round(ini, 2), round(ant, 2)))
            ini = x
        ant = x
    trechos.append((round(ini, 2), round(ant, 2)))
    ys = [c.y for c in cs if abs(c.z - z) < 0.006]
    print("Z %.2f" % z, trechos, "y", round(min(ys), 2), round(max(ys), 2))

u.preparar_foto(5)
d = 5.5
u.foto("lhama_frente", PASTA, (0, -d, 0.95), (0, 0, 0.95), lente=50)
u.foto("lhama_lado", PASTA, (d, 0, 0.95), (0, 0, 0.95), lente=50)
u.foto("lhama_costas", PASTA, (0, d, 0.95), (0, 0, 0.95), lente=50)
