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
- **Tela cheia (⛶):** botão no lobby, nos ajustes e na partida. No celular o jogo entra em tela cheia no primeiro toque e volta sozinho depois de girar o aparelho. No iPhone (sem tela cheia para sites), use Compartilhar → Adicionar à Tela de Início: o jogo instala como app, sem barra de endereço.
- **Placas de vídeo antigas:** se o navegador só tem WebGL 1 (comum em PCs antigos), o jogo usa um modo de compatibilidade (Three.js fixado na 0.160, a última com WebGL 1) e começa em qualidade baixa. Sem nenhum WebGL, aparece uma tela explicando como resolver.
- **Sala por senha:** um jogador cria a sala (com uma senha à escolha), os outros entram com a mesma senha.
- **Amigos:** cada um escolhe um apelido curto (3 a 12 letras/números). Um envia o pedido pelo apelido, o outro aceita; depois é só convidar quem estiver online, sem senha. Toda conexão entre amigos é verificada por HMAC.

Controles: WASD move, mouse mira, clique atira, Espaço pula, R recarrega, 1/2/3 troca de arma (rifle, pistola, granada), Tab mostra o placar.
