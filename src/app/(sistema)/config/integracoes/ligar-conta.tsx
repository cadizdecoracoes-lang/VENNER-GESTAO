"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Campo, estiloBotao, estiloCampo } from "@/components/ui";
import type { EmpresaResumo } from "@/lib/empresa";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { chamarFuncao } from "@/lib/supabase/funcoes";

// Clique em "Ligar conta": a Edge Function integracoes guarda o estado da
// autorização e devolve o endereço da plataforma; a plataforma volta para esta tela.
export function LigarConta({ canal, empresas, rotulo }: { canal: string; empresas: EmpresaResumo[]; rotulo: string }) {
  const [erro, setErro] = useState("");
  const [indo, setIndo] = useState(false);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setErro("");
        setIndo(true);
        try {
          const { url } = await chamarFuncao<{ url: string }>(criarClienteNavegador(), "integracoes", {
            acao: "conectar",
            canal,
            empresa: String(new FormData(e.currentTarget).get("empresa") ?? ""),
            voltar: `${window.location.origin}${window.location.pathname}`,
          });
          window.location.assign(url);
        } catch (falha) {
          setErro(falha instanceof Error ? falha.message : String(falha));
          setIndo(false);
        }
      }}
    >
      <Campo rotulo="Empresa dona da conta" className="min-w-56 flex-1">
        <select name="empresa" required defaultValue={empresas.length === 1 ? empresas[0].id : ""} className={estiloCampo}>
          <option value="" disabled>
            Escolha...
          </option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </select>
      </Campo>
      <button type="submit" disabled={indo} className={estiloBotao}>
        {indo ? "Abrindo..." : rotulo}
      </button>
      {erro && <p className="w-full text-sm text-perigo">{erro}</p>}
    </form>
  );
}

export type VoltaDaPlataforma = { ligacao: string; state?: string; code?: string; shop_id?: string; error?: string; error_description?: string };

// Volta da plataforma (?ligacao=...&code=...): termina a ligação com o login de quem começou.
export function ConcluirLigacao({ volta }: { volta: VoltaDaPlataforma }) {
  const router = useRouter();
  const feito = useRef(false);

  useEffect(() => {
    if (feito.current) return;
    feito.current = true;
    const { ligacao, ...resto } = volta;
    chamarFuncao<{ canal: string }>(criarClienteNavegador(), "integracoes", { acao: "concluir", canal: ligacao, ...resto })
      .then((r) => router.replace(`?ligada=${r.canal === "tiny" ? "tiny" : "1"}`))
      .catch((e) => router.replace(`?erro=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`));
  }, [router, volta]);

  return <p className="rounded-xl bg-primaria/10 px-4 py-2.5 text-sm text-primaria">Terminando a ligação da conta...</p>;
}
