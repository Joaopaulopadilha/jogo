import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

// base relativa: o build funciona em qualquer subpasta (ex.: GitHub Pages)
// `vite --mode https` sobe com certificado de teste: necessário para testar "Amigos" em outro PC da rede,
// porque a criptografia (WebCrypto) só existe em https ou localhost
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "https" ? [basicSsl()] : [],
}));
