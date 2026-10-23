import { Plus } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Campo,
  Cartao,
  Celula,
  Etiqueta,
  FaixaEmpresa,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { formatarMoeda, formatarNumero } from "@/lib/formato";
import { NOME_CANAL, type Canal } from "@/lib/plataformas/tipos";
import { carregarProdutosVenda } from "@/lib/vendas";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { removerAnuncio, salvarAnuncio } from "./actions";

const TELA = "vendas.anuncios";

type Anuncio = {
  id: string;
  empresa_id: string;
  canal: Canal;
  codigo: string;
  titulo: string | null;
  item_id: string;
  quantidade: number;
  itens: { codigo: string; descricao: string; preco_venda: number } | null;
};
type Filtros = { novo?: string; editar?: string; codigo?: string; canal?: string; titulo?: string; voltar?: string };

async function carregar(empresa: string | null): Promise<Anuncio[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  let consulta = supabase
    .from("anuncios_plataforma")
    .select("id, empresa_id, canal, codigo, titulo, item_id, quantidade, itens(codigo, descricao, preco_venda)")
    .order("canal")
    .order("codigo")
    .limit(5000);
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  return ((await consulta).data ?? []) as unknown as Anuncio[];
}

export default async function PaginaAnuncios({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const anuncios = await carregar(selecionada?.id ?? null);
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const emEdicao = filtros.editar ? anuncios.find((a) => a.id === filtros.editar) : undefined;
  const mostrarForm = (filtros.novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));
  const produtos = mostrarForm ? await carregarProdutosVenda() : [];
  const voltar = filtros.voltar === "importar" ? "importar" : null;
  const kits = new Map<string, number>();
  for (const a of anuncios)
    kits.set(`${a.empresa_id}|${a.canal}|${a.codigo}`, (kits.get(`${a.empresa_id}|${a.canal}|${a.codigo}`) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Ligar anúncio
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar anúncio ${emEdicao.codigo}` : "Ligar anúncio a um produto"}>
          <FormAcao
            key={emEdicao?.id ?? "novo"}
            acao={salvarAnuncio.bind(null, emEdicao?.id ?? null, voltar)}
            rotulo="Salvar"
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Empresa dona do anúncio" className="sm:col-span-2">
                <select name="empresa_id" required defaultValue={emEdicao?.empresa_id ?? selecionada?.id ?? ""} className={estiloCampo}>
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
              <Campo rotulo="Plataforma">
                <select name="canal" required defaultValue={emEdicao?.canal ?? filtros.canal ?? "mercado_livre"} className={estiloCampo}>
                  {Object.entries(NOME_CANAL).map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>
                      {rotulo}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Código do anúncio" dica="Mercado Livre: MLB... · Shopee: SKU da variação.">
                <input name="codigo" required defaultValue={emEdicao?.codigo ?? filtros.codigo} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Título do anúncio (opcional)" className="sm:col-span-2">
                <input name="titulo" defaultValue={emEdicao?.titulo ?? filtros.titulo} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Produto que sai do estoque">
                <select name="item_id" required defaultValue={emEdicao?.item_id ?? ""} className={estiloCampo}>
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codigo} · {p.descricao}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Unidades por venda" dica="Kit com 2 cadeiras = 2.">
                <input name="quantidade" inputMode="decimal" defaultValue={emEdicao?.quantidade ?? 1} className={estiloCampo} />
              </Campo>
            </div>
            <p className="text-xs text-texto-suave">
              Kit com produtos diferentes: ligue o mesmo código uma vez para cada produto. O valor da venda é dividido entre eles.
            </p>
            <div className="flex justify-end">
              <Link href={voltar ? "/financeiro/receber/importar" : "/vendas/anuncios"} className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <FaixaEmpresa empresa={selecionada} />

      <Filtro
        atalhos={[{ rotulo: "Plataforma", opcoes: Object.entries(NOME_CANAL).map(([valor, rotulo]) => ({ valor, rotulo })) }]}
        placeholder="Filtrar por código, título ou produto..."
      >
        <Tabela
          colunas={["Plataforma", ...(selecionada ? [] : ["Empresa"]), "Anúncio", "Produto", "Unidades por venda", "Preço de tabela", ""]}
          vazio="Nenhum anúncio ligado ainda. Ao importar as vendas, o sistema mostra os anúncios que faltam."
        >
          {anuncios.map((a) => (
            <tr key={a.id} data-tags={a.canal}>
              <Celula>
                <Etiqueta cor={a.canal === "mercado_livre" ? "alerta" : "primaria"}>{NOME_CANAL[a.canal] ?? a.canal}</Etiqueta>
              </Celula>
              {!selecionada && <Celula className="whitespace-nowrap text-texto-suave">{nomeEmpresa.get(a.empresa_id) ?? "—"}</Celula>}
              <Celula>
                <span className="font-medium">{a.codigo}</span>
                {a.titulo && <span className="block text-xs text-texto-suave">{a.titulo}</span>}
              </Celula>
              <Celula>
                {a.itens ? `${a.itens.codigo} · ${a.itens.descricao}` : "—"}
                {(kits.get(`${a.empresa_id}|${a.canal}|${a.codigo}`) ?? 0) > 1 && (
                  <span className="block text-xs text-texto-suave">parte de um kit com produtos diferentes</span>
                )}
              </Celula>
              <Celula className="tabular-nums">{formatarNumero(a.quantidade)}</Celula>
              <Celula className="tabular-nums text-texto-suave">
                {a.itens && Number(a.itens.preco_venda) > 0 ? formatarMoeda(Number(a.itens.preco_venda) * Number(a.quantidade)) : "—"}
              </Celula>
              <Celula className="whitespace-nowrap text-right">
                {pode(acesso, TELA, "editar") && (
                  <div className="flex items-center justify-end gap-3">
                    <LinkAcao href={`?editar=${a.id}`}>Editar</LinkAcao>
                    <FormAcao
                      acao={removerAnuncio.bind(null, a.id)}
                      rotulo="Remover"
                      enviando="..."
                      discreto
                      confirmar="Desligar este anúncio do produto? As vendas já importadas não mudam."
                    />
                  </div>
                )}
              </Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}
