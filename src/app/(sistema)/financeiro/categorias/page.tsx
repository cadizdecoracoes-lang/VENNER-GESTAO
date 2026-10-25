"use client";

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
import { TIPOS_PLANO_CONTA, type TipoPlanoConta } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { salvarPlanoConta } from "./actions";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.categorias";

type PlanoConta = { id: string; codigo: string; nome: string; tipo: TipoPlanoConta; pai_id: string | null; ativa: boolean };
type Filtros = { editar?: string; novo?: string; pai?: string };

async function carregar(): Promise<PlanoConta[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("plano_contas").select("id, codigo, nome, tipo, pai_id, ativa");
  return (data ?? []) as PlanoConta[];
}

// Ordena 1, 1.2, 1.10 como números, não como texto.
function compararCodigo(a: string, b: string) {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

// Próximo código livre abaixo de uma categoria: 4 → 4.08 se já existem 4.01 a 4.07.
function proximoCodigo(pai: PlanoConta, contas: PlanoConta[]) {
  const filhas = contas.filter((c) => c.pai_id === pai.id).map((c) => Number(c.codigo.split(".").at(-1)));
  return `${pai.codigo}.${String(Math.max(0, ...filhas) + 1).padStart(2, "0")}`;
}

async function PaginaCategorias({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const contas = (await carregar()).sort((a, b) => compararCodigo(a.codigo, b.codigo));
  const emEdicao = filtros.editar ? contas.find((c) => c.id === filtros.editar) : undefined;
  const paiNovo = filtros.pai ? contas.find((c) => c.id === filtros.pai) : undefined;
  const mostrarForm = (filtros.novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));
  const temFilhas = new Set(contas.map((c) => c.pai_id).filter(Boolean));
  const podeCriar = pode(acesso, TELA, "criar");

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {podeCriar && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Nova categoria principal
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao
          titulo={
            emEdicao
              ? `Editar ${emEdicao.codigo} ${emEdicao.nome}`
              : paiNovo
                ? `Nova categoria abaixo de ${paiNovo.codigo} ${paiNovo.nome}`
                : "Nova categoria principal"
          }
        >
          <FormAcao
            key={emEdicao?.id ?? paiNovo?.id ?? "novo"}
            acao={salvarPlanoConta.bind(null, emEdicao?.id ?? null)}
            rotulo="Salvar"
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Código" dica="Números separados por ponto, ex.: 4.07.">
                <input
                  name="codigo"
                  required
                  defaultValue={emEdicao?.codigo ?? (paiNovo ? proximoCodigo(paiNovo, contas) : "")}
                  className={estiloCampo}
                />
              </Campo>
              <Campo rotulo="Nome" className="lg:col-span-3">
                <input name="nome" required defaultValue={emEdicao?.nome} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Fica abaixo de" className="sm:col-span-2" dica="Deixe em branco para uma categoria principal.">
                <select name="pai_id" defaultValue={emEdicao?.pai_id ?? paiNovo?.id ?? ""} className={estiloCampo}>
                  <option value="">Nenhuma (categoria principal)</option>
                  {contas
                    .filter((c) => c.id !== emEdicao?.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} {c.nome}
                      </option>
                    ))}
                </select>
              </Campo>
              <Campo rotulo="Tipo" dica="Subcategorias seguem o tipo da categoria acima.">
                <select name="tipo" defaultValue={emEdicao?.tipo ?? paiNovo?.tipo ?? "despesa"} className={estiloCampo}>
                  {Object.entries(TIPOS_PLANO_CONTA).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativa" defaultChecked={emEdicao?.ativa ?? true} />
                Categoria ativa
              </label>
              <Link href="/financeiro/categorias" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <p className="text-sm text-texto-suave">
        As contas a pagar e a receber usam as categorias sem subcategorias (as mais detalhadas). As categorias em negrito somam as de baixo
        nos relatórios. Elas valem para todo o grupo; o CNPJ fica em cada lançamento.
      </p>

      <Filtro
        atalhos={[
          { rotulo: "Tipo", opcoes: Object.entries(TIPOS_PLANO_CONTA).map(([valor, rotulo]) => ({ valor, rotulo })) },
          ATALHO_SITUACAO,
        ]}
      >
        <Tabela colunas={["Código", "Categoria", "Tipo", ""]} vazio="Nenhuma categoria cadastrada ainda.">
          {contas.map((c) => {
            const nivel = c.codigo.split(".").length - 1;
            const agrupadora = temFilhas.has(c.id);
            return (
              <tr key={c.id} data-tags={`${c.tipo} ${c.ativa ? "ativo" : "inativo"}`} className={c.ativa ? "" : "text-texto-suave"}>
                <Celula className={`tabular-nums ${agrupadora ? "font-semibold" : ""}`}>{c.codigo}</Celula>
                <Celula>
                  <span style={{ paddingLeft: `${nivel * 1.25}rem` }} className={agrupadora ? "font-semibold" : ""}>
                    {c.nome}
                  </span>{" "}
                  {!c.ativa && <Etiqueta>Inativa</Etiqueta>}
                </Celula>
                <Celula>
                  <Etiqueta cor={c.tipo === "receita" ? "sucesso" : "neutra"}>{TIPOS_PLANO_CONTA[c.tipo]}</Etiqueta>
                </Celula>
                <Celula className="space-x-3 whitespace-nowrap text-right">
                  {podeCriar && <LinkAcao href={`?novo=1&pai=${c.id}`}>Nova subcategoria</LinkAcao>}
                  {pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${c.id}`}>Editar</LinkAcao>}
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaCategorias} />;
}
