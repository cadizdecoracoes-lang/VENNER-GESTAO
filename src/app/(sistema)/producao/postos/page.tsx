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
import { formatarMoeda, formatarNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarPosto } from "./actions";

const TELA = "producao.postos";

type Posto = { id: string; nome: string; custo_hora: number; capacidade_horas_dia: number; ativo: boolean };

async function carregar(): Promise<Posto[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("postos_trabalho").select("id, nome, custo_hora, capacidade_horas_dia, ativo").order("nome");
  return (data ?? []) as Posto[];
}

export default async function PaginaPostos({ searchParams }: { searchParams: Promise<{ editar?: string; novo?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const { editar, novo } = await searchParams;
  const postos = await carregar();
  const emEdicao = editar ? postos.find((p) => p.id === editar) : undefined;
  const mostrarForm = (novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo posto
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome}` : "Novo posto de trabalho"}>
          <FormAcao key={emEdicao?.id ?? "novo"} acao={salvarPosto.bind(null, emEdicao?.id ?? null)} rotulo="Salvar" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Nome">
                <input name="nome" required defaultValue={emEdicao?.nome} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Custo hora (R$)" dica="Mão de obra e máquina. Entra no custo padrão da ficha.">
                <input name="custo_hora" inputMode="decimal" defaultValue={emEdicao?.custo_hora ?? 0} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Capacidade (horas por dia)" dica="Usado no sequenciamento da produção.">
                <input
                  name="capacidade_horas_dia"
                  inputMode="decimal"
                  defaultValue={emEdicao?.capacidade_horas_dia ?? 8}
                  className={estiloCampo}
                />
              </Campo>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao?.ativo ?? true} />
                Posto ativo
              </label>
              <Link href="/producao/postos" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Filtro atalhos={[ATALHO_SITUACAO]}>
        <Tabela colunas={["Posto", "Custo hora", "Capacidade", "Situação", ""]} vazio="Nenhum posto de trabalho cadastrado ainda.">
          {postos.map((p) => (
            <tr key={p.id} data-tags={p.ativo ? "ativo" : "inativo"}>
              <Celula className="font-medium">{p.nome}</Celula>
              <Celula className="tabular-nums">{formatarMoeda(p.custo_hora)}</Celula>
              <Celula className="tabular-nums">{formatarNumero(p.capacidade_horas_dia)} h/dia</Celula>
              <Celula>{p.ativo ? <Etiqueta cor="sucesso">Ativo</Etiqueta> : <Etiqueta>Inativo</Etiqueta>}</Celula>
              <Celula className="text-right">{pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${p.id}`}>Editar</LinkAcao>}</Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}
