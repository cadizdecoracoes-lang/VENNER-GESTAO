import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { FormAcao } from "@/components/form-acao";
import { CabecalhoTela, Campo, Cartao, Celula, Etiqueta, LinkAcao, SemAcesso, Tabela, estiloBotao, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { formatarMoeda, formatarNumero } from "@/lib/formato";
import { TIPOS_COM_FICHA, TIPOS_ITEM, type TipoItem } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarItem } from "./actions";

const TELA = "estoque.itens";

type Item = {
  id: string;
  codigo: string;
  descricao: string;
  tipo: TipoItem;
  unidade: string;
  estoque_minimo: number;
  prazo_reposicao_dias: number;
  custo_medio: number;
  ativo: boolean;
};

type Unidade = { sigla: string; descricao: string };

type Filtros = { q?: string; tipo?: string; editar?: string; novo?: string };

async function carregar({ q, tipo }: Filtros) {
  if (!supabaseConfigurado) return { itens: [] as Item[], unidades: [{ sigla: "UN", descricao: "Unidade" }] as Unidade[] };
  const supabase = await criarClienteServidor();
  let consulta = supabase
    .from("itens")
    .select("id, codigo, descricao, tipo, unidade, estoque_minimo, prazo_reposicao_dias, custo_medio, ativo")
    .order("codigo")
    .limit(500);
  if (q) {
    const termo = q.replace(/[%,()]/g, " ").trim();
    consulta = consulta.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`);
  }
  if (tipo && tipo in TIPOS_ITEM) consulta = consulta.eq("tipo", tipo);
  const [{ data: itens }, { data: unidades }] = await Promise.all([
    consulta,
    supabase.from("unidades").select("sigla, descricao").order("sigla"),
  ]);
  return { itens: (itens ?? []) as Item[], unidades: (unidades ?? []) as Unidade[] };
}

export default async function PaginaItens({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const { itens, unidades } = await carregar(filtros);
  let emEdicao = filtros.editar ? itens.find((i) => i.id === filtros.editar) : undefined;
  if (filtros.editar && !emEdicao && supabaseConfigurado) {
    // O item pode estar fora do filtro atual.
    const supabase = await criarClienteServidor();
    const { data } = await supabase
      .from("itens")
      .select("id, codigo, descricao, tipo, unidade, estoque_minimo, prazo_reposicao_dias, custo_medio, ativo")
      .eq("id", filtros.editar)
      .maybeSingle();
    emEdicao = (data as Item | null) ?? undefined;
  }
  const mostrarForm = (filtros.novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));
  const verFicha = pode(acesso, "producao.ficha_tecnica", "ver");

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo item
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.codigo}` : "Novo item"}>
          <FormAcao key={emEdicao?.id ?? "novo"} acao={salvarItem.bind(null, emEdicao?.id ?? null)} rotulo="Salvar" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Código">
                <input name="codigo" required defaultValue={emEdicao?.codigo} className={`${estiloCampo} uppercase`} />
              </Campo>
              <Campo rotulo="Descrição" className="sm:col-span-1 lg:col-span-3">
                <input name="descricao" required defaultValue={emEdicao?.descricao} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Tipo">
                <select name="tipo" required defaultValue={emEdicao?.tipo ?? ""} className={estiloCampo}>
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {Object.entries(TIPOS_ITEM).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Unidade">
                <select name="unidade" required defaultValue={emEdicao?.unidade ?? "UN"} className={estiloCampo}>
                  {unidades.map((u) => (
                    <option key={u.sigla} value={u.sigla}>
                      {u.sigla} · {u.descricao}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Estoque mínimo">
                <input name="estoque_minimo" inputMode="decimal" defaultValue={emEdicao?.estoque_minimo ?? 0} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Prazo de reposição (dias)" dica="Usado pelo MRP para saber quando comprar.">
                <input name="prazo_reposicao_dias" inputMode="numeric" defaultValue={emEdicao?.prazo_reposicao_dias ?? 0} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Custo médio (R$)" dica="Base do custo padrão da ficha técnica. Será atualizado pelas compras.">
                <input name="custo_medio" inputMode="decimal" defaultValue={emEdicao?.custo_medio ?? 0} className={estiloCampo} />
              </Campo>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao?.ativo ?? true} />
                Item ativo
              </label>
              <Link href="/estoque/itens" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <form className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-texto-suave" />
          <input name="q" defaultValue={filtros.q} placeholder="Buscar por código ou descrição" className={`${estiloCampo} w-72 pl-9`} />
        </div>
        <select name="tipo" defaultValue={filtros.tipo ?? ""} className={`${estiloCampo} w-48`}>
          <option value="">Todos os tipos</option>
          {Object.entries(TIPOS_ITEM).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
        <button className={estiloBotaoSecundario}>Filtrar</button>
      </form>

      <Tabela
        colunas={["Código", "Descrição", "Tipo", "Un.", "Estoque mín.", "Reposição", "Custo médio", ""]}
        vazio={filtros.q || filtros.tipo ? "Nenhum item encontrado com esse filtro." : "Nenhum item cadastrado ainda."}
      >
        {itens.map((i) => (
          <tr key={i.id} className={i.ativo ? "" : "text-texto-suave"}>
            <Celula className="font-medium">{i.codigo}</Celula>
            <Celula>
              {i.descricao} {!i.ativo && <Etiqueta>Inativo</Etiqueta>}
            </Celula>
            <Celula>{TIPOS_ITEM[i.tipo]}</Celula>
            <Celula>{i.unidade}</Celula>
            <Celula className="tabular-nums">{formatarNumero(i.estoque_minimo)}</Celula>
            <Celula className="tabular-nums">{i.prazo_reposicao_dias} dias</Celula>
            <Celula className="tabular-nums">{formatarMoeda(i.custo_medio)}</Celula>
            <Celula className="space-x-3 whitespace-nowrap text-right">
              {verFicha && TIPOS_COM_FICHA.includes(i.tipo) && <LinkAcao href={`/producao/ficha-tecnica?item=${i.id}`}>Ficha</LinkAcao>}
              {pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${i.id}`}>Editar</LinkAcao>}
            </Celula>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
