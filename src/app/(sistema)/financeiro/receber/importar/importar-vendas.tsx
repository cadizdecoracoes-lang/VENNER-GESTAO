"use client";

import { FileUp } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FormAcao } from "@/components/form-acao";
import { Campo, Cartao, Celula, Etiqueta, Tabela, estiloBotaoSecundario, estiloCampo } from "@/components/ui";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/formato";
import {
  acharCabecalho,
  CAMPOS,
  lerVendas,
  mapearColunas,
  type Campo as CampoPlanilha,
  type Celula as CelulaPlanilha,
  type Mapa,
} from "@/lib/plataformas/planilha";
import { NOME_CANAL, type Canal } from "@/lib/plataformas/tipos";
import { importarVendas } from "../actions";

type Opcao = { id: string; nome: string };
type Props = { empresas: Opcao[]; empresaInicial: string; locais: Opcao[]; produtos: Opcao[]; ligados: string[] };

// Dias até a plataforma liberar o dinheiro, quando a planilha não traz a data.
const DIAS_PADRAO: Record<Canal, number> = { mercado_livre: 15, shopee: 10 };

// CSV com ";" ou ",", aspas e quebras de linha dentro das aspas.
function lerCsv(texto: string): CelulaPlanilha[][] {
  const primeira = texto.slice(0, texto.indexOf("\n") + 1 || undefined);
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let linha: string[] = [];
  let celula = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        celula += '"';
        i++;
      } else if (c === '"') aspas = false;
      else celula += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(celula);
      celula = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(celula);
      linhas.push(linha);
      linha = [];
      celula = "";
    } else celula += c;
  }
  if (celula || linha.length) linhas.push([...linha, celula]);
  return linhas;
}

export function ImportarVendas({ empresas, empresaInicial, locais, produtos, ligados }: Props) {
  const [empresa, setEmpresa] = useState(empresaInicial);
  const [canal, setCanal] = useState<Canal>("mercado_livre");
  const [local, setLocal] = useState(locais.find((l) => /expedi/i.test(l.nome))?.id ?? locais[0]?.id ?? "");
  const [dias, setDias] = useState(DIAS_PADRAO.mercado_livre);
  const [linhas, setLinhas] = useState<CelulaPlanilha[][] | null>(null);
  const [cabecalho, setCabecalho] = useState(-1);
  const [mapa, setMapa] = useState<Mapa>({});
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [erroLeitura, setErroLeitura] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  // Produto e unidades escolhidos para cada anúncio ainda não ligado.
  const [ligar, setLigar] = useState<Record<string, { item_id: string; quantidade: number }>>({});

  function prepararColunas(dados: CelulaPlanilha[][], c: Canal) {
    const cab = acharCabecalho(dados, c);
    setCabecalho(cab < 0 ? 0 : cab);
    setMapa(mapearColunas(dados[cab < 0 ? 0 : cab] ?? [], c));
  }

  async function ler(f: File | undefined) {
    setLinhas(null);
    setErroLeitura(null);
    setLigar({});
    if (!f) return;
    setLendo(true);
    setArquivo(f.name);
    try {
      let dados: CelulaPlanilha[][];
      if (/\.csv$/i.test(f.name) || f.type === "text/csv") {
        dados = lerCsv(await f.text());
      } else {
        const { default: lerXlsx } = await import("read-excel-file");
        dados = (await lerXlsx(f)) as CelulaPlanilha[][];
      }
      if (dados.length < 2) throw new Error("A planilha está vazia.");
      prepararColunas(dados, canal);
      setLinhas(dados);
    } catch (e) {
      setErroLeitura(
        e instanceof Error && e.message.includes("vazia")
          ? e.message
          : "Não foi possível ler o arquivo. Use a planilha .xlsx ou .csv baixada da plataforma.",
      );
    } finally {
      setLendo(false);
    }
  }

  function trocarCanal(c: Canal) {
    setCanal(c);
    setDias(DIAS_PADRAO[c]);
    setLigar({});
    if (linhas) prepararColunas(linhas, c);
  }

  const leitura = useMemo(() => (linhas ? lerVendas(linhas, cabecalho + 1, mapa, dias) : null), [linhas, cabecalho, mapa, dias]);

  // Anúncios das vendas que ainda não estão ligados a um produto nesta empresa.
  const faltando = useMemo(() => {
    const conhecidos = new Set(ligados);
    const lista = new Map<string, { codigo: string; titulo: string; vendas: number }>();
    for (const v of leitura?.vendas ?? []) {
      for (const i of v.itens) {
        if (conhecidos.has(`${empresa}|${canal}|${i.codigo}`)) continue;
        const atual = lista.get(i.codigo) ?? { codigo: i.codigo, titulo: i.titulo, vendas: 0 };
        atual.vendas++;
        lista.set(i.codigo, atual);
      }
    }
    return [...lista.values()].sort((a, b) => b.vendas - a.vendas);
  }, [leitura, ligados, empresa, canal]);

  const vendas = leitura?.vendas ?? [];
  const total = vendas.reduce((s, v) => s + v.valor, 0);
  const tarifas = vendas.reduce((s, v) => s + v.tarifas, 0);
  const pendentes = faltando.filter((a) => !ligar[a.codigo]?.item_id);
  const colunas = linhas?.[cabecalho] ?? [];

  const dados = JSON.stringify({
    empresa,
    canal,
    local,
    vendas,
    ligar: faltando.map((a) => ({
      codigo: a.codigo,
      titulo: a.titulo,
      item_id: ligar[a.codigo]?.item_id ?? "",
      quantidade: ligar[a.codigo]?.quantidade ?? 1,
    })),
  });

  return (
    <div className="space-y-3">
      <Cartao titulo="1. De onde são as vendas">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo rotulo="Empresa dona da conta">
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={estiloCampo}>
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
            <select value={canal} onChange={(e) => trocarCanal(e.target.value as Canal)} className={estiloCampo}>
              {Object.entries(NOME_CANAL).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Estoque sai de">
            <select value={local} onChange={(e) => setLocal(e.target.value)} className={estiloCampo}>
              {locais.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Dias até liberar o dinheiro" dica="Contados da data da venda. Vira o vencimento do título.">
            <input
              type="number"
              min={0}
              max={120}
              value={dias}
              onChange={(e) => setDias(Number(e.target.value) || 0)}
              className={estiloCampo}
            />
          </Campo>
        </div>
      </Cartao>

      <Cartao titulo="2. Planilha de vendas">
        <div className="space-y-3">
          <label className={`${estiloBotaoSecundario} cursor-pointer`}>
            <FileUp size={16} /> {lendo ? "Lendo..." : arquivo ? "Trocar planilha" : "Escolher planilha (.xlsx ou .csv)"}
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => ler(e.target.files?.[0])} />
          </label>
          {arquivo && !lendo && <p className="text-sm text-texto-suave">{arquivo}</p>}
          {erroLeitura && <p className="text-sm text-perigo">{erroLeitura}</p>}
          <p className="text-xs text-texto-suave">
            {canal === "mercado_livre"
              ? "No Mercado Livre: Vendas › Exportar (botão no alto da lista de vendas), escolha o período e baixe em Excel."
              : "Na Shopee: Central do Vendedor › Meus pedidos › Exportar, escolha o período e baixe o arquivo."}{" "}
            Vendas canceladas, devolvidas ou não pagas ficam de fora, e uma venda já importada não entra duas vezes.
          </p>
        </div>
      </Cartao>

      {linhas && leitura && (
        <Cartao titulo="3. Colunas da planilha">
          <p className="mb-3 text-sm text-texto-suave">
            O sistema reconheceu as colunas pelo nome. Se alguma ficou errada ou vazia, escolha a coluna certa.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(CAMPOS) as CampoPlanilha[]).map((campo) => (
              <Campo key={campo} rotulo={CAMPOS[campo]}>
                <select
                  value={mapa[campo] ?? ""}
                  onChange={(e) => setMapa({ ...mapa, [campo]: e.target.value === "" ? undefined : Number(e.target.value) })}
                  className={estiloCampo}
                >
                  <option value="">Não tem</option>
                  {colunas.map((c, i) => (
                    <option key={i} value={i}>
                      {String(c ?? `Coluna ${i + 1}`)}
                    </option>
                  ))}
                </select>
              </Campo>
            ))}
          </div>
        </Cartao>
      )}

      {leitura && leitura.problemas.length > 0 && (
        <div className="rounded-xl bg-alerta/10 px-4 py-3 text-sm text-alerta">
          {leitura.problemas.slice(0, 8).map((p) => (
            <p key={p}>{p}</p>
          ))}
          {leitura.problemas.length > 8 && <p>e mais {leitura.problemas.length - 8}.</p>}
        </div>
      )}

      {faltando.length > 0 && (
        <Cartao titulo={`4. Anúncios sem produto ligado (${faltando.length})`}>
          <p className="mb-3 text-sm text-texto-suave">
            Diga qual produto sai do estoque em cada anúncio. Fica gravado em Vendas › Anúncios das plataformas e vale para as próximas
            importações. Kit com produtos diferentes: ligue um produto aqui e os demais na tela de anúncios antes de importar.
          </p>
          <Tabela colunas={["Anúncio", "Vendas", "Produto", "Unidades por venda"]} embutida>
            {faltando.map((a) => (
              <tr key={a.codigo}>
                <Celula>
                  <span className="font-medium">{a.codigo}</span>
                  <span className="block text-xs text-texto-suave">{a.titulo}</span>
                </Celula>
                <Celula className="tabular-nums">{a.vendas}</Celula>
                <Celula>
                  <select
                    value={ligar[a.codigo]?.item_id ?? ""}
                    onChange={(e) =>
                      setLigar({ ...ligar, [a.codigo]: { quantidade: ligar[a.codigo]?.quantidade ?? 1, item_id: e.target.value } })
                    }
                    className={estiloCampo}
                  >
                    <option value="">Escolha o produto...</option>
                    {produtos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </select>
                </Celula>
                <Celula>
                  <input
                    type="number"
                    min={1}
                    value={ligar[a.codigo]?.quantidade ?? 1}
                    onChange={(e) =>
                      setLigar({
                        ...ligar,
                        [a.codigo]: { item_id: ligar[a.codigo]?.item_id ?? "", quantidade: Number(e.target.value) || 1 },
                      })
                    }
                    className={`${estiloCampo} max-w-24`}
                  />
                </Celula>
              </tr>
            ))}
          </Tabela>
        </Cartao>
      )}

      {leitura && (
        <Cartao titulo={`${faltando.length > 0 ? "5" : "4"}. Conferir e importar`}>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <Resumo
              rotulo="Vendas na planilha"
              valor={formatarNumero(vendas.length)}
              detalhe={`${leitura.ignoradas} canceladas ou devolvidas ficaram de fora`}
            />
            <Resumo rotulo="Valor das vendas" valor={formatarMoeda(total)} />
            <Resumo rotulo="Tarifas e frete" valor={formatarMoeda(tarifas)} />
            <Resumo rotulo="Líquido a receber" valor={formatarMoeda(total - tarifas)} />
          </div>
          <Tabela
            colunas={["Venda", "Data", "Libera em", "Anúncios", "Valor", "Tarifas", "Líquido"]}
            embutida
            vazio="Nenhuma venda reconhecida na planilha."
          >
            {vendas.slice(0, 200).map((v) => (
              <tr key={v.numero}>
                <Celula className="font-medium">
                  {v.numero}
                  {v.comprador && <span className="block text-xs font-normal text-texto-suave">{v.comprador}</span>}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums">{formatarData(v.data)}</Celula>
                <Celula className="whitespace-nowrap tabular-nums">{formatarData(v.liberacao)}</Celula>
                <Celula className="text-xs">
                  {v.itens.map((i) => (
                    <span key={i.codigo} className="block">
                      {formatarNumero(i.quantidade)} × {i.codigo}{" "}
                      {faltando.some((f) => f.codigo === i.codigo) && !ligar[i.codigo]?.item_id && (
                        <Etiqueta cor="alerta">sem produto</Etiqueta>
                      )}
                    </span>
                  ))}
                </Celula>
                <Celula className="tabular-nums">{formatarMoeda(v.valor)}</Celula>
                <Celula className="tabular-nums text-texto-suave">{formatarMoeda(v.tarifas)}</Celula>
                <Celula className="tabular-nums">{formatarMoeda(v.valor - v.tarifas)}</Celula>
              </tr>
            ))}
          </Tabela>
          {vendas.length > 200 && (
            <p className="mt-2 text-xs text-texto-suave">Mostrando 200 de {vendas.length}; todas serão importadas.</p>
          )}
          <FormAcao acao={importarVendas} rotulo={`Importar ${vendas.length} vendas`} enviando="Importando..." className="mt-4 space-y-3">
            <input type="hidden" name="dados" value={dados} />
            {pendentes.length > 0 && (
              <p className="text-sm text-alerta">
                Escolha o produto de {pendentes.length === 1 ? "1 anúncio" : `${pendentes.length} anúncios`} acima.
              </p>
            )}
            <p className="text-xs text-texto-suave">
              Cada venda vira um pedido já entregue (fora da fila de produção), dá baixa no estoque do local escolhido e gera um título a
              receber pelo líquido, com vencimento na data de liberação.
            </p>
          </FormAcao>
        </Cartao>
      )}

      <div className="flex justify-end">
        <Link href="/financeiro/receber" className={estiloBotaoSecundario}>
          Voltar para o contas a receber
        </Link>
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-xl bg-fundo px-4 py-3">
      <p className="text-xs text-texto-suave">{rotulo}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
      {detalhe && <p className="text-xs text-texto-suave">{detalhe}</p>}
    </div>
  );
}
