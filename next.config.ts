import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // XML e PDF das notas de fornecedores são enviados pelas ações do servidor.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};

export default nextConfig;
