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
import { CADASTROS_COMERCIAL, ehCadastro, mostrarDias, type CampoCadastro, type ChaveCadastro } from "@/lib/cadastros-comercial";
import { formatarDocumento, formatarNumero } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarCadastroComercial } from "./actions";

const TELA = "vendas.cadastros";

type Linha = Record<string, unknown> & { id: string; nome: string; tiny_id?: number | null };

// Valor do campo como aparece na lista e no formulário.
function mostrar(c: CampoCadastro, v: unknown, noForm = false): string {
  if (v === null || v === undefined || v === "") return noForm ? "" : "—";
  if (c.tipo === "dias") return noForm ? (v as number[]).join("/") : mostrarDias(v as number[]);
  if (c.tipo === "numero") return noForm ? String(v).replace(".", ",") : formatarNumero(Number(v));
  if (c.tipo === "documento") return noForm ? String(v) : formatarDocumento(String(v));
  return String(v);
}

export default async function PaginaCadastrosComercial({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; editar?: string; novo?: string }>;
}) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const { aba: abaPedida, editar, novo } = await searchParams;
  const aba: ChaveCadastro = ehCadastro(abaPedida) ? abaPedida : "vendedores";
  const cad = CADASTROS_COMERCIAL[aba];

  let linhas: Linha[] = [];
  const precosPorLista = new Map<string, number>();
  if (supabaseConfigurado) {
    const supabase = await criarClienteServidor();
    // Condição de pagamento não tem código no Tiny: vem escrita no pedido.
    const colunas = ["id", ...(aba === "condicoes" ? [] : ["tiny_id"]), cad.ativo, ...cad.campos.map((c) => c.nome)].join(", ");
    linhas = ((await supabase.from(cad.tabela).select(colunas).order("nome").limit(2000)).data ?? []) as unknown as Linha[];
    if (aba === "listas") {
      const { data } = await supabase.from("lista_preco_itens").select("lista_id").limit(20000);
      for (const p of data ?? []) precosPorLista.set(p.lista_id, (precosPorLista.get(p.lista_id) ?? 0) + 1);
    }
  }
  const emEdicao = editar ? linhas.find((l) => l.id === editar) : undefined;
  const mostrarForm = (novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));
  const ativo = (l: Linha) => l[cad.ativo] === true;

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href={`?aba=${aba}&novo=1`} className={estiloBotao}>
            <Plus size={16} /> {cad.novo}
          </Link>
        )}
      </CabecalhoTela>

      <nav className="flex flex-wrap gap-1 border-b border-borda" aria-label="Cadastros">
        {Object.entries(CADASTROS_COMERCIAL).map(([chave, c]) => (
          <Link
            key={chave}
            href={`?aba=${chave}`}
            aria-current={chave === aba ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              chave === aba ? "border-primaria font-medium text-primaria" : "border-transparent text-texto-suave hover:text-texto"
            }`}
          >
            {c.titulo}
          </Link>
        ))}
      </nav>

      <p className="text-sm text-texto-suave">
        Os cadastros marcados “Do Tiny” chegam todo dia pela integração. Pode incluir novos e ajustar os que existem aqui.
      </p>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome}` : cad.novo}>
          <FormAcao
            key={emEdicao?.id ?? "novo"}
            acao={salvarCadastroComercial.bind(null, aba, emEdicao?.id ?? null)}
            rotulo="Salvar"
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {cad.campos.map((c) => (
                <Campo key={c.nome} rotulo={c.rotulo} dica={c.dica}>
                  <input
                    name={c.nome}
                    required={"obrigatorio" in c && c.obrigatorio}
                    inputMode={c.tipo === "texto" ? undefined : "decimal"}
                    defaultValue={emEdicao ? mostrar(c, emEdicao[c.nome], true) : ""}
                    className={estiloCampo}
                  />
                </Campo>
              ))}
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao ? ativo(emEdicao) : true} />
                Ativo
              </label>
              <Link href={`/vendas/cadastros?aba=${aba}`} className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Filtro atalhos={[ATALHO_SITUACAO]} iniciais={{ Situação: "ativo" }}>
        <Tabela
          colunas={[...cad.campos.map((c) => c.rotulo), ...(aba === "listas" ? ["Preços próprios"] : []), ""]}
          vazio={`Nenhum cadastro em ${cad.titulo.toLowerCase()}.`}
        >
          {linhas.map((l) => (
            <tr key={l.id} data-tags={ativo(l) ? "ativo" : "inativo"} className={ativo(l) ? "" : "text-texto-suave"}>
              {cad.campos.map((c, i) => (
                <Celula key={c.nome} className={i === 0 ? "font-medium" : c.tipo === "numero" ? "tabular-nums" : undefined}>
                  {mostrar(c, l[c.nome])}
                  {i === 0 && (
                    <>
                      {l.tiny_id != null && <Etiqueta cor="primaria">Do Tiny</Etiqueta>} {!ativo(l) && <Etiqueta>Inativo</Etiqueta>}
                    </>
                  )}
                </Celula>
              ))}
              {aba === "listas" && <Celula className="tabular-nums">{precosPorLista.get(l.id) ?? 0}</Celula>}
              <Celula className="text-right">
                {pode(acesso, TELA, "editar") && <LinkAcao href={`?aba=${aba}&editar=${l.id}`}>Editar</LinkAcao>}
              </Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}
