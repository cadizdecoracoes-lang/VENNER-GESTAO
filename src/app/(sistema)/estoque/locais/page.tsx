import { Plus } from "lucide-react";
import Link from "next/link";
import { ATALHO_SITUACAO, Filtro } from "@/components/filtro";
import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Campo,
  Cartao,
  Celula,
  Etiqueta,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarLocal } from "./actions";

const TELA = "estoque.locais";

type Local = { id: string; nome: string; ativo: boolean };

async function carregar(): Promise<Local[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("locais_estoque").select("id, nome, ativo").order("nome");
  return (data ?? []) as Local[];
}

export default async function PaginaLocais({ searchParams }: { searchParams: Promise<{ editar?: string; novo?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const { editar, novo } = await searchParams;
  const locais = await carregar();
  const emEdicao = editar ? locais.find((l) => l.id === editar) : undefined;
  const mostrarForm = (novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo local
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome}` : "Novo local de estoque"}>
          <FormAcao key={emEdicao?.id ?? "novo"} acao={salvarLocal.bind(null, emEdicao?.id ?? null)} rotulo="Salvar" className="space-y-4">
            <Campo rotulo="Nome" dica="Ex.: Almoxarifado, Linha de montagem, Expedição." className="max-w-md">
              <input name="nome" required defaultValue={emEdicao?.nome} className={estiloCampo} />
            </Campo>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao?.ativo ?? true} />
                Local ativo
              </label>
              <Link href="/estoque/locais" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Filtro atalhos={[ATALHO_SITUACAO]}>
        <Tabela colunas={["Local", "Situação", ""]} vazio="Nenhum local de estoque cadastrado ainda.">
          {locais.map((l) => (
            <tr key={l.id} data-tags={l.ativo ? "ativo" : "inativo"}>
              <Celula className="font-medium">{l.nome}</Celula>
              <Celula>{l.ativo ? <Etiqueta cor="sucesso">Ativo</Etiqueta> : <Etiqueta>Inativo</Etiqueta>}</Celula>
              <Celula className="text-right">{pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${l.id}`}>Editar</LinkAcao>}</Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}
