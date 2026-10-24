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

- **Solo:** contra 1 a 3 bots, com 3 dificuldades.
- **Online:** um jogador cria a sala (com uma senha à escolha), os outros entram com a mesma senha.
- **Amigos:** troque o código de amigo uma vez; depois é só convidar quem estiver online, sem senha.

Controles: WASD move, mouse mira, clique atira, Espaço pula, R recarrega, 1/2/3 troca de arma (rifle, pistola, granada), Tab mostra o placar.
