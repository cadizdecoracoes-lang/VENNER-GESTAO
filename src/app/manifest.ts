import type { MetadataRoute } from "next";

// Permite instalar o sistema como aplicativo (Chrome › três pontinhos ›
// Transmitir, salvar e compartilhar › Instalar página como app), com ícone e
// janela próprios. Para trocar o ícone, substitua os arquivos public/icone-*.
export const dynamic = "force-static";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Venner Gestão",
    short_name: "Venner",
    description: "Sistema de gestão do Grupo Venner",
    start_url: `${BASE}/`,
    scope: `${BASE}/`,
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#4a6fa5",
    lang: "pt-BR",
    icons: [
      { src: `${BASE}/icone-192.png`, sizes: "192x192", type: "image/png" },
      { src: `${BASE}/icone-512.png`, sizes: "512x512", type: "image/png" },
      { src: `${BASE}/icone-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
