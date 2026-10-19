import { ClipboardList } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Campo,
  Cartao,
  Celula,
  Etiqueta,
  Fonte,
  Indicador,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { formatarMoeda, formatarNumero } from "@/lib/formato";
import { TIPOS_ITEM, type TipoItem } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { registrarInventario } from "./actions";

const TELA = "estoque.saldos";

type Item = { id: string; codigo: string; descricao: string; tipo: TipoItem; unidade: string; estoque_minimo: number; custo_medio: number };
type Filtros = { ver?: string; inventario?: string; ajustes?: string; contados?: string };

async function carregar() {
  if (!supabaseConfigurado)
    return {
      itens: [] as Item[],
      locais: [] as { id: string; nome: string }[],
      saldos: [] as { item_id: string; local_id: string; saldo: number }[],
    };
  const supabase = await criarClienteServidor();
  const [itens, locais, saldos] = await Promise.all([
    supabase
      .from("itens")
      .select("id, codigo, descricao, tipo, unidade, estoque_minimo, custo_medio")
      .eq("ativo", true)
      .neq("tipo", "servico")
      .order("codigo")
      .limit(5000),
    supabase.from("locais_estoque").select("id, nome").eq("ativo", true).order("nome"),
    supabase.from("saldos_estoque").select("item_id, local_id, saldo").limit(20000),
  ]);
  return {
    itens: (itens.data ?? []) as Item[],
    locais: (locais.data ?? []) as { id: string; nome: string }[],
    saldos: (saldos.data ?? []) as { item_id: string; local_id: string; saldo: number }[],
  };
}

export default async function PaginaSaldos({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const filtros = await searchParams;
  const { itens, locais, saldos } = await carregar();
  const nomeLocal = new Map(locais.map((l) => [l.id, l.nome]));

  const porItem = new Map<string, { total: number; locais: { local: string; saldo: number }[] }>();
  for (const s of saldos) {
    const atual = porItem.get(s.item_id) ?? { total: 0, locais: [] };
    atual.total += Number(s.saldo);
    if (Number(s.saldo) !== 0) atual.locais.push({ local: s.local_id, saldo: Number(s.saldo) });
    porItem.set(s.item_id, atual);
  }
  const saldo = (id: string) => porItem.get(id)?.total ?? 0;
  const abaixo = itens.filter((i) => Number(i.estoque_minimo) > 0 && saldo(i.id) < Number(i.estoque_minimo));
  const negativos = itens.filter((i) => saldo(i.id) < 0);
  const valor = itens.reduce((s, i) => s + Math.max(0, saldo(i.id)) * Number(i.custo_medio), 0);
  const visiveis = filtros.ver === "minimo" ? abaixo : filtros.ver === "negativo" ? negativos : itens;

  const contando = filtros.inventario ? locais.find((l) => l.id === filtros.inventario) : undefined;
  const podeContar = pode(acesso, "estoque.movimentos", "criar");
  const saldoNoLocal = new Map(saldos.filter((s) => s.local_id === contando?.id).map((s) => [s.item_id, Number(s.saldo)]));

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, "estoque.movimentos", "ver") && (
          <Link href="/estoque/movimentos" className={estiloBotaoSecundario}>
            Movimentações
          </Link>
        )}
        {podeContar && !contando && locais.length > 0 && (
          <Link href={`?inventario=${locais[0].id}`} className={estiloBotao}>
            <ClipboardList size={16} /> Fazer inventário
          </Link>
        )}
      </CabecalhoTela>

      {filtros.ajustes !== undefined && (
        <p className="rounded-xl bg-sucesso/10 px-4 py-2.5 text-sm text-sucesso">
          Inventário registrado: {filtros.contados} {filtros.contados === "1" ? "item contado" : "itens contados"}, {filtros.ajustes}{" "}
          {filtros.ajustes === "1" ? "ajuste lançado" : "ajustes lançados"} (só onde a contagem diferia do sistema).
        </p>
      )}

      {contando && podeContar && (
        <Cartao titulo={`Inventário: ${contando.nome}`}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-texto-suave">Local contado</span>
              {locais.map((l) => (
                <Link
                  key={l.id}
                  href={`?inventario=${l.id}`}
                  className={`rounded-full px-3 py-1 ${l.id === contando.id ? "bg-primaria-suave font-medium text-primaria" : "text-texto-suave hover:bg-fundo"}`}
                >
                  {l.nome}
                </Link>
              ))}
            </div>
            <Fonte>
              Digite o que foi contado fisicamente. Item em branco não muda. Onde a contagem for diferente do sistema, entra um ajuste com a
              diferença (origem &quot;inventário&quot;), e o saldo do local passa a ser exatamente o contado.
            </Fonte>
            <FormAcao
              key={contando.id}
              acao={registrarInventario.bind(null, contando.id)}
              rotulo="Registrar inventário"
              className="space-y-4"
            >
              <Filtro placeholder="Filtrar por código ou descrição...">
                <Tabela colunas={["Item", "No sistema", "Contado"]} embutida>
                  {itens.map((i) => (
                    <tr key={i.id}>
                      <Celula>
                        <span className="font-medium">{i.codigo}</span> · {i.descricao}
                        <span className="block text-xs text-texto-suave">{TIPOS_ITEM[i.tipo]}</span>
                      </Celula>
                      <Celula className="whitespace-nowrap tabular-nums text-texto-suave">
                        {formatarNumero(saldoNoLocal.get(i.id) ?? 0)} {i.unidade}
                      </Celula>
                      <Celula className="w-40">
                        <input name={`contagem_${i.id}`} inputMode="decimal" aria-label={`Contado ${i.codigo}`} className={estiloCampo} />
                      </Celula>
                    </tr>
                  ))}
                </Tabela>
              </Filtro>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <Campo rotulo="Observação" className="w-full max-w-md">
                  <input name="observacao" placeholder="Ex.: Inventário inicial, contagem de outubro" className={estiloCampo} />
                </Campo>
                <Link href="/estoque/saldos" className={estiloBotaoSecundario}>
                  Cancelar
                </Link>
              </div>
            </FormAcao>
          </div>
        </Cartao>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          rotulo="Abaixo do estoque mínimo"
          valor={abaixo.length}
          detalhe={abaixo.length === 1 ? "item" : "itens"}
          cor={abaixo.length ? "text-alerta" : ""}
          href="?ver=minimo"
          fonte="Saldo total do grupo (todos os locais) menor que o estoque mínimo do cadastro do item."
        />
        <Indicador
          rotulo="Saldo negativo"
          valor={negativos.length}
          detalhe={negativos.length === 1 ? "item: confira as saídas" : "itens: confira as saídas"}
          cor={negativos.length ? "text-perigo" : ""}
          href="?ver=negativo"
          fonte="Mais saídas que entradas registradas. Um inventário acerta o saldo."
        />
        <Indicador
          rotulo="Valor em estoque"
          valor={formatarMoeda(valor)}
          href="?"
          fonte="Saldo positivo de cada item × custo médio do cadastro (atualizado nas entradas de nota)."
        />
      </div>

      {filtros.ver && (
        <p className="text-sm">
          Mostrando só {filtros.ver === "minimo" ? "itens abaixo do mínimo" : "itens com saldo negativo"}.{" "}
          <LinkAcao href="?">Ver todos</LinkAcao>
        </p>
      )}

      <Filtro
        atalhos={[
          {
            rotulo: "Tipo",
            opcoes: Object.entries(TIPOS_ITEM)
              .filter(([v]) => v !== "servico")
              .map(([valor, rotulo]) => ({ valor, rotulo })),
          },
        ]}
        placeholder="Filtrar por código, descrição, local..."
      >
        <Tabela colunas={["Item", "Saldo do grupo", "Por local", "Mínimo", "Custo médio", "Valor"]} vazio="Nenhum item neste filtro.">
          {visiveis.map((i) => {
            const s = saldo(i.id);
            const baixo = Number(i.estoque_minimo) > 0 && s < Number(i.estoque_minimo);
            return (
              <tr key={i.id} data-tags={i.tipo}>
                <Celula>
                  <span className="font-medium">{i.codigo}</span> · {i.descricao}
                  <span className="block text-xs text-texto-suave">{TIPOS_ITEM[i.tipo]}</span>
                </Celula>
                <Celula className={`whitespace-nowrap tabular-nums ${s < 0 ? "text-perigo" : baixo ? "text-alerta" : ""}`}>
                  {pode(acesso, "estoque.movimentos", "ver") ? (
                    <LinkAcao href={`/estoque/movimentos?item=${i.id}`}>
                      {formatarNumero(s)} {i.unidade}
                    </LinkAcao>
                  ) : (
                    `${formatarNumero(s)} ${i.unidade}`
                  )}
                  {baixo && (
                    <span className="ml-2">
                      <Etiqueta cor="alerta">Abaixo do mínimo</Etiqueta>
                    </span>
                  )}
                </Celula>
                <Celula className="text-xs text-texto-suave">
                  {(porItem.get(i.id)?.locais ?? [])
                    .map((l) => `${nomeLocal.get(l.local) ?? "?"} ${formatarNumero(l.saldo)}`)
                    .join(" · ") || "—"}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums text-texto-suave">
                  {Number(i.estoque_minimo) ? formatarNumero(Number(i.estoque_minimo)) : "—"}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums text-texto-suave">{formatarMoeda(Number(i.custo_medio))}</Celula>
                <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(Math.max(0, s) * Number(i.custo_medio))}</Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
      <Fonte>
        Saldo = soma de todas as movimentações registradas (entradas de nota, ajustes de inventário e saídas), por item e local. Clique no
        saldo para ver as movimentações que o formam.
      </Fonte>
    </div>
  );
}
