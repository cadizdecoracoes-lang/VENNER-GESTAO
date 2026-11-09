"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { aoRecarregar, NaoEncontrado } from "@/lib/navegacao";

type Busca = Record<string, string>;
// Mesma forma das páginas do Next com servidor: os filtros do endereço chegam
// em searchParams e, nas telas de um registro, o id chega em params (?id=...).
type Montar = (props: { searchParams: Promise<any>; params: Promise<any> }) => Promise<React.ReactNode>;

// Monta a tela no navegador: busca os dados (montar) e refaz depois de cada
// gravação (revalidatePath) ou quando o endereço muda.
export function TelaCliente({ montar }: { montar: Montar }) {
  return (
    <Suspense fallback={<Carregando />}>
      <Tela montar={montar} />
    </Suspense>
  );
}

function Tela({ montar }: { montar: Montar }) {
  const busca = useSearchParams();
  const chave = busca.toString();
  const [versao, setVersao] = useState(0);
  const [conteudo, setConteudo] = useState<React.ReactNode>(null);
  const [falha, setFalha] = useState<"nao-encontrado" | string | null>(null);
  // Enquanto busca a tela nova (filtro clicado, depois de gravar), a de antes
  // fica visível e esmaecida: o clique tem resposta na hora.
  const [atualizando, setAtualizando] = useState(false);
  const ultima = useRef(0);

  useEffect(() => aoRecarregar(() => setVersao((v) => v + 1)), []);

  useEffect(() => {
    const vez = ++ultima.current;
    const filtros: Busca = Object.fromEntries(new URLSearchParams(chave));
    // Só esmaece se demorar: resposta rápida não pisca.
    const aviso = setTimeout(() => {
      if (vez === ultima.current) setAtualizando(true);
    }, 150);
    montar({ searchParams: Promise.resolve(filtros), params: Promise.resolve(filtros) })
      .then((n) => {
        if (vez !== ultima.current) return;
        setFalha(null);
        setConteudo(n);
      })
      .catch((e: unknown) => {
        if (vez !== ultima.current) return;
        setFalha(e instanceof NaoEncontrado ? "nao-encontrado" : e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        clearTimeout(aviso);
        if (vez === ultima.current) setAtualizando(false);
      });
  }, [montar, chave, versao]);

  if (falha === "nao-encontrado") return <p className="mt-16 text-center text-texto-suave">Registro não encontrado.</p>;
  if (falha) return <p className="rounded-xl bg-perigo/10 px-4 py-2.5 text-sm text-perigo">Não foi possível abrir a tela: {falha}</p>;
  if (!conteudo) return <Carregando />;
  return (
    <div aria-busy={atualizando} className={`transition-opacity ${atualizando ? "opacity-60" : ""}`}>
      {conteudo}
    </div>
  );
}

export function Carregando() {
  return <p className="text-sm text-texto-suave">Carregando...</p>;
}
