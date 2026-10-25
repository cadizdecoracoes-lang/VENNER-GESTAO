import { FileUp } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { CabecalhoTela, Celula, Etiqueta, LinkAcao, SemAcesso, Tabela, estiloBotao } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { ORIGENS_NOTA, type OrigemNota } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";

const TELA = "financeiro.notas_fornecedor";

type Nota = {
  id: string;
  empresa_id: string;
  numero: string;
  serie: string | null;
  data_emissao: string;
  valor_total: number;
  origem: OrigemNota;
  entrada_em: string | null;
  fornecedores: { nome: string; nome_fantasia: string | null } | null;
  nota_fornecedor_itens: { item_id: string | null }[];
};

// Em que pé está a nota em relação ao estoque.
function situacao(n: Nota): { tag: string; rotulo: string; cor: "neutra" | "primaria" | "sucesso" | "alerta" } {
  if (n.entrada_em) return { tag: "lancada", rotulo: "Estoque lançado", cor: "sucesso" };
  if (n.nota_fornecedor_itens.length === 0) return { tag: "sem_itens", rotulo: "Sem produtos", cor: "neutra" };
  const faltam = n.nota_fornecedor_itens.filter((i) => !i.item_id).length;
  if (faltam > 0) return { tag: "vincular", rotulo: `${faltam} sem vínculo`, cor: "alerta" };
  return { tag: "pronta", rotulo: "Pronta para entrada", cor: "primaria" };
}

export default async function PaginaNotasFornecedor() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);

  let notas: Nota[] = [];
  if (supabaseConfigurado) {
    const supabase = await criarClienteServidor();
    let consulta = supabase
      .from("notas_fornecedor")
      .select(
        "id, empresa_id, numero, serie, data_emissao, valor_total, origem, entrada_em, fornecedores(nome, nome_fantasia), nota_fornecedor_itens(item_id)",
      )
      .order("data_emissao", { ascending: false })
      .order("criado_em", { ascending: false })
      .limit(2000);
    if (selecionada) consulta = consulta.eq("empresa_id", selecionada.id);
    notas = ((await consulta).data ?? []) as unknown as Nota[];
  }
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const colunas = ["Emissão", ...(selecionada ? [] : ["Empresa"]), "Fornecedor", "Nota", "Valor", "Estoque", ""];

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} empresa={selecionada}>
        {pode(acesso, TELA, "criar") && (
          <Link href="/financeiro/notas-fornecedor/importar" className={estiloBotao}>
            <FileUp size={16} /> Importar nota
          </Link>
        )}
      </CabecalhoTela>


      <Filtro
        atalhos={[
          {
            rotulo: "Estoque",
            opcoes: [
              { valor: "vincular", rotulo: "Falta vincular" },
              { valor: "pronta", rotulo: "Prontas para entrada" },
              { valor: "lancada", rotulo: "Lançadas" },
            ],
          },
        ]}
        placeholder="Filtrar por fornecedor, número, valor..."
      >
        <Tabela colunas={colunas} vazio="Nenhuma nota lançada ainda. Use Importar nota com o XML ou o PDF do fornecedor.">
          {notas.map((n) => {
            const s = situacao(n);
            return (
              <tr key={n.id} data-tags={s.tag}>
                <Celula className="whitespace-nowrap tabular-nums">{formatarData(n.data_emissao)}</Celula>
                {!selecionada && <Celula className="whitespace-nowrap text-texto-suave">{nomeEmpresa.get(n.empresa_id) ?? "—"}</Celula>}
                <Celula className="font-medium">{n.fornecedores?.nome_fantasia || n.fornecedores?.nome}</Celula>
                <Celula className="whitespace-nowrap">
                  {n.numero}
                  {n.serie && <span className="text-texto-suave"> · série {n.serie}</span>}
                  <span className="block text-xs text-texto-suave">{ORIGENS_NOTA[n.origem]}</span>
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(n.valor_total)}</Celula>
                <Celula>
                  <Etiqueta cor={s.cor}>{s.rotulo}</Etiqueta>
                </Celula>
                <Celula className="text-right">
                  <LinkAcao href={`/financeiro/notas-fornecedor/${n.id}`}>Abrir</LinkAcao>
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}
