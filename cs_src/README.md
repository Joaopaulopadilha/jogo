# CS Caps

FPS 3D online para 2 a 4 jogadores, feito com TypeScript, Three.js e PeerJS (WebRTC). O host é autoritativo (tiros, vida, rounds e granadas).

## Rodar

```
npm install
npm run dev          # http://localhost:5173
npm run dev:https    # https://<ip-da-rede>:5174 (necessário para testar Amigos em outro PC)
npm run build
```

## Jogar

- **Lobby:** a tela inicial mostra seu personagem em 3D, o grupo, os amigos online e o modo. O líder convida amigos para o grupo e escolhe o modo; quando todos apertam PRONTO, a partida começa para todos, sem senha.
- **Modos:** mata-mata com CPUs (de 1 a 3, em 3 dificuldades; sozinho é o treino) e mata-mata do grupo (só os amigos, entre si).
- **Ajustes (⚙):** no lobby e na pausa da partida. Brilho da imagem, qualidade gráfica (resolução) e sensibilidade da mira; ficam salvos no aparelho.
- **Sala por senha:** um jogador cria a sala (com uma senha à escolha), os outros entram com a mesma senha.
- **Amigos:** cada um escolhe um apelido curto (3 a 12 letras/números). Um envia o pedido pelo apelido, o outro aceita; depois é só convidar quem estiver online, sem senha. Toda conexão entre amigos é verificada por HMAC.

Controles: WASD move, mouse mira, clique atira, Espaço pula, R recarrega, 1/2/3 troca de arma (rifle, pistola, granada), Tab mostra o placar.
