import { defineConfig } from "vite";

// carimbo da versao: vai no codigo (__VERSAO__) e em versao.json; o jogo compara os dois e se atualiza sozinho quando o celular guardou uma versao velha
const versao = String(Date.now());

// base relativa: o build funciona em qualquer subpasta (GitHub Pages). O resultado vai para ../truco (a pasta publicada).
export default defineConfig({
  base: "./",
  define: { __VERSAO__: JSON.stringify(versao) },
  build: { outDir: "../truco", emptyOutDir: true },
  plugins: [
    {
      name: "versao-json",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "versao.json", source: JSON.stringify({ v: versao }) });
      },
    },
  ],
});
