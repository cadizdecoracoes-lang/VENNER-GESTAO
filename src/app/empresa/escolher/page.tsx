"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { Carregando } from "@/components/tela-cliente";
import { caminhoSeguro } from "@/lib/endereco";
import { carregarEmpresas } from "@/lib/empresa";
import { COOKIE_EMPRESA } from "@/lib/empresa-cookie";

// Troca a empresa do seletor do topo e volta para a tela (links do resumo por empresa).
function Escolher() {
  const busca = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const id = busca.get("id") ?? "";
    const destino = caminhoSeguro(busca.get("volta"));
    carregarEmpresas()
      .catch(() => [])
      .then((empresas) => {
        document.cookie = empresas.some((e) => e.id === id)
          ? `${COOKIE_EMPRESA}=${id}; path=/; max-age=31536000; samesite=lax`
          : `${COOKIE_EMPRESA}=; path=/; max-age=0; samesite=lax`;
        router.replace(destino);
      });
  }, [busca, router]);

  return <Carregando />;
}

export default function PaginaEscolherEmpresa() {
  return (
    <Suspense fallback={<Carregando />}>
      <Escolher />
    </Suspense>
  );
}
