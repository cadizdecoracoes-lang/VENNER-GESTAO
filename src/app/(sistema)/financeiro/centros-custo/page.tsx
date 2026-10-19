import { Plus } from "lucide-react";
import Link from "next/link";
import { FormAcao } from "@/components/form-acao";
import { CabecalhoTela, Campo, Cartao, Celula, Etiqueta, LinkAcao, SemAcesso, Tabela, estiloBotao, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarCentro } from "./actions";

const TELA = "financeiro.centros_custo";

type Centro = { id: string; codigo: string; nome: string; ativo: boolean };

async function carregar(): Promise<Centro[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("centros_custo").select("id, codigo, nome, ativo").order("codigo");
  return (data ?? []) as Centro[];
}

export default async function PaginaCentrosCusto({ searchParams }: { searchParams: Promise<{ editar?: string; novo?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const { editar, novo } = await searchParams;
  const centros = await carregar();
  const emEdicao = editar ? centros.find((c) => c.id === editar) : undefined;
  const mostrarForm = (novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo centro de custo
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome}` : "Novo centro de custo"}>
          <FormAcao key={emEdicao?.id ?? "novo"} acao={salvarCentro.bind(null, emEdicao?.id ?? null)} rotulo="Salvar" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Código" dica="Curto, ex.: FAB, COM, ADM.">
                <input name="codigo" required defaultValue={emEdicao?.codigo} className={`${estiloCampo} uppercase`} />
              </Campo>
              <Campo rotulo="Nome" className="sm:col-span-2">
                <input name="nome" required defaultValue={emEdicao?.nome} className={estiloCampo} />
              </Campo>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao?.ativo ?? true} />
                Centro de custo ativo
              </label>
              <Link href="/financeiro/centros-custo" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Tabela colunas={["Código", "Nome", "Situação", ""]} vazio="Nenhum centro de custo cadastrado ainda.">
        {centros.map((c) => (
          <tr key={c.id}>
            <Celula className="font-medium">{c.codigo}</Celula>
            <Celula>{c.nome}</Celula>
            <Celula>{c.ativo ? <Etiqueta cor="sucesso">Ativo</Etiqueta> : <Etiqueta>Inativo</Etiqueta>}</Celula>
            <Celula className="text-right">{pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${c.id}`}>Editar</LinkAcao>}</Celula>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
