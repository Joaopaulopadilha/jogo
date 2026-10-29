# Desenha o ícone do app (retroescavadeira amarela em fundo escuro): public/icone-512.png, -192 e -180 (iPhone).
import os
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.join(AQUI, "..", "public")
T = 512
im = Image.new("RGBA", (T, T), (29, 32, 38, 255))
d = ImageDraw.Draw(im)
amarelo = (242, 177, 15, 255)
escuro = (22, 22, 22, 255)
aro = (242, 177, 15, 255)
# chão
d.rectangle([0, 400, T, T], fill=(110, 75, 42, 255))
# braço traseiro (esquerda): lança e braço com a concha
d.line([(170, 260), (95, 140), (60, 300)], fill=amarelo, width=26, joint="curve")
d.polygon([(40, 300), (95, 290), (90, 345), (50, 340)], fill=amarelo)
# corpo, capô e cabine
d.rounded_rectangle([150, 250, 420, 330], 14, fill=amarelo)
d.rounded_rectangle([330, 215, 430, 260], 10, fill=amarelo)
d.rectangle([185, 130, 300, 255], fill=escuro)
d.rectangle([197, 142, 288, 243], fill=(150, 200, 225, 255))
d.rectangle([178, 118, 308, 136], fill=amarelo)
# pá da frente
d.line([(330, 260), (455, 330)], fill=amarelo, width=18)
d.polygon([(440, 300), (500, 300), (505, 375), (440, 370)], fill=amarelo)
# rodas
for cx, cy, r in ((215, 345, 62), (385, 360, 45)):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=escuro)
    d.ellipse([cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5], fill=aro)
for tam in (512, 192, 180):
    im.resize((tam, tam), Image.LANCZOS).convert("RGB").save(os.path.join(PUB, f"icone-{tam}.png"))
print("ok")
