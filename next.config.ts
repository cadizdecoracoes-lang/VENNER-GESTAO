import type { NextConfig } from "next";

// Site estático (GitHub Pages): cada tela vira uma página HTML e os dados vêm
// do Supabase direto no navegador. NEXT_PUBLIC_BASE_PATH é o caminho do
// repositório no endereço do GitHub Pages (ex.: /VENNER-GESTAO).
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
