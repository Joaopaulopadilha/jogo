"""Recorta as 3 poses de image_8d1a2882.jpg, tira o fundo branco e grava public/heroi.png
(uma tira com quadros do mesmo tamanho: parado, andando, correndo; todos com os pés na mesma linha).
Uso: python ferramentas/recortar.py   (precisa do Pillow)"""
from collections import deque
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
FATOR = 4  # a arte é "pixel art" ampliada: reduzir 4x mantém o traço e deixa o arquivo leve


def parecido_com_fundo(p, tol):
    return p[0] > 255 - tol and p[1] > 255 - tol and p[2] > 255 - tol


def mascara_do_personagem(img):
    """True onde é personagem. Fundo = branco ligado à borda; e também ilhas brancas grandes presas (vão das pernas/braços)."""
    larg, alt = img.size
    px = img.load()
    fundo = bytearray(larg * alt)
    visto = bytearray(larg * alt)
    fila = deque()
    for x in range(larg):
        fila.append((x, 0))
        fila.append((x, alt - 1))
    for y in range(alt):
        fila.append((0, y))
        fila.append((larg - 1, y))
    while fila:
        x, y = fila.popleft()
        i = y * larg + x
        if visto[i]:
            continue
        visto[i] = 1
        if not parecido_com_fundo(px[x, y], 38):
            continue
        fundo[i] = 1
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < larg and 0 <= ny < alt and not visto[ny * larg + nx]:
                fila.append((nx, ny))
    # ilhas quase brancas que não tocam a borda: grandes são vão de fundo; pequenas são brilho/olho
    for y0 in range(alt):
        for x0 in range(larg):
            i0 = y0 * larg + x0
            if visto[i0] or not parecido_com_fundo(px[x0, y0], 14):
                continue
            ilha = []
            fila = deque([(x0, y0)])
            visto[i0] = 1
            while fila:
                x, y = fila.popleft()
                ilha.append(y * larg + x)
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    j = ny * larg + nx
                    if 0 <= nx < larg and 0 <= ny < alt and not visto[j] and parecido_com_fundo(px[nx, ny], 22):
                        visto[j] = 1
                        fila.append((nx, ny))
            if len(ilha) > 700:
                for j in ilha:
                    fundo[j] = 1
    return fundo


def main():
    img = Image.open(RAIZ / "image_8d1a2882.jpg").convert("RGB")
    larg, alt = img.size
    fundo = mascara_do_personagem(img)
    rgba = img.convert("RGBA")
    dados = rgba.load()
    for y in range(alt):
        for x in range(larg):
            if fundo[y * larg + x]:
                dados[x, y] = (0, 0, 0, 0)

    # separa as poses pelas colunas vazias
    alfa = rgba.getchannel("A")
    colunas = [alfa.crop((x, 0, x + 1, alt)).getbbox() is not None for x in range(larg)]
    faixas, ini = [], None
    for x, tem in enumerate(colunas + [False]):
        if tem and ini is None:
            ini = x
        elif not tem and ini is not None:
            if x - ini > 60:  # ignora sujeirinhas do JPEG
                faixas.append((ini, x))
            ini = None
    assert len(faixas) == 3, f"esperava 3 poses, achei {len(faixas)}: {faixas}"

    poses = []
    for a, b in faixas:
        recorte = rgba.crop((a, 0, b, alt))
        recorte = recorte.crop(recorte.getchannel("A").getbbox())
        w, h = recorte.size
        pequeno = recorte.resize((round(w / FATOR), round(h / FATOR)), Image.BOX)
        # bordas duras, como pixel art
        r, g, bl, al = pequeno.split()
        al = al.point(lambda v: 255 if v >= 140 else 0)
        pequeno = Image.merge("RGBA", (r, g, bl, al))
        poses.append(pequeno)

    # alinha pela cabeça (centro dos pontos do quarto de cima) para o personagem não "tremer" ao trocar de pose
    def centro_cabeca(p):
        a = p.getchannel("A").load()
        xs = [x for y in range(p.height // 4) for x in range(p.width) if a[x, y]]
        return sum(xs) / len(xs)

    centros = [centro_cabeca(p) for p in poses]
    esquerda = max(centros)
    direita = max(p.width - c for p, c in zip(poses, centros))
    qw = int(esquerda + direita) + 2
    qh = max(p.height for p in poses) + 1
    tira = Image.new("RGBA", (qw * 3, qh), (0, 0, 0, 0))
    for i, (p, c) in enumerate(zip(poses, centros)):
        tira.paste(p, (i * qw + round(esquerda - c) + 1, qh - p.height), p)
    saida = RAIZ / "public" / "heroi.png"
    saida.parent.mkdir(exist_ok=True)
    tira.save(saida, optimize=True)
    print(f"quadro {qw}x{qh}, centro da cabeça em x={round(esquerda) + 1}; salvo em {saida}")


if __name__ == "__main__":
    main()
