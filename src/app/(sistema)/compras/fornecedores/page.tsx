import { Plus } from "lucide-react";
import Link from "next/link";
import { CamposPessoa } from "@/components/campos-pessoa";
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
import { formatarDocumento } from "@/lib/formato";
import type { DadosPessoa } from "@/lib/pessoa";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarFornecedor } from "./actions";

const TELA = "compras.fornecedores";
const CAMPOS =
  "id, tipo_pessoa, documento, nome, nome_fantasia, email, telefone, cidade, uf, observacao, ativo, prazo_entrega_dias, condicao_pagamento";

type Fornecedor = DadosPessoa & { id: string; prazo_entrega_dias: number; condicao_pagamento: string | null };
type Filtros = { editar?: string; novo?: string };

async function carregar(): Promise<Fornecedor[]> {
  if (!supabaseConfigurado) return [];
  const supabase = await criarClienteServidor();
  const consulta = supabase.from("fornecedores").select(CAMPOS).order("nome").limit(2000);
  const { data } = await consulta;
  return (data ?? []) as Fornecedor[];
}

async function buscar(id: string): Promise<Fornecedor | undefined> {
  if (!supabaseConfigurado) return undefined;
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from("fornecedores").select(CAMPOS).eq("id", id).maybeSingle();
  return (data as Fornecedor | null) ?? undefined;
}

export default async function PaginaFornecedores({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const fornecedores = await carregar();
  const emEdicao = filtros.editar ? (fornecedores.find((f) => f.id === filtros.editar) ?? (await buscar(filtros.editar))) : undefined;
  const mostrarForm = (filtros.novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo fornecedor
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome}` : "Novo fornecedor"}>
          <FormAcao
            key={emEdicao?.id ?? "novo"}
            acao={salvarFornecedor.bind(null, emEdicao?.id ?? null)}
            rotulo="Salvar"
            className="space-y-4"
          >
            <CamposPessoa valor={emEdicao} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Prazo de entrega (dias)" dica="O MRP usa para saber com quanta antecedência comprar.">
                <input
                  name="prazo_entrega_dias"
                  inputMode="numeric"
                  defaultValue={emEdicao?.prazo_entrega_dias ?? 0}
                  className={estiloCampo}
                />
              </Campo>
              <Campo rotulo="Condição de pagamento" dica="Ex.: 30/60/90 dias, à vista.">
                <input name="condicao_pagamento" defaultValue={emEdicao?.condicao_pagamento ?? ""} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Observação" className="sm:col-span-2">
                <input name="observacao" defaultValue={emEdicao?.observacao ?? ""} className={estiloCampo} />
              </Campo>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao?.ativo ?? true} />
                Fornecedor ativo
              </label>
              <Link href="/compras/fornecedores" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Filtro atalhos={[ATALHO_SITUACAO]} placeholder="Filtrar por nome, CNPJ/CPF, cidade, UF...">
        <Tabela
          colunas={["Fornecedor", "CNPJ / CPF", "Cidade", "Contato", "Prazo", "Pagamento", ""]}
          vazio="Nenhum fornecedor cadastrado ainda."
        >
          {fornecedores.map((f) => (
            <tr key={f.id} data-tags={f.ativo ? "ativo" : "inativo"} className={f.ativo ? "" : "text-texto-suave"}>
              <Celula>
                <span className="font-medium">{f.nome_fantasia ?? f.nome}</span> {!f.ativo && <Etiqueta>Inativo</Etiqueta>}
                {f.nome_fantasia && <span className="block text-xs text-texto-suave">{f.nome}</span>}
              </Celula>
              <Celula className="whitespace-nowrap tabular-nums">{formatarDocumento(f.documento)}</Celula>
              <Celula>{[f.cidade, f.uf].filter(Boolean).join(" / ") || "—"}</Celula>
              <Celula className="text-texto-suave">{[f.telefone, f.email].filter(Boolean).join(" · ") || "—"}</Celula>
              <Celula className="whitespace-nowrap tabular-nums">{f.prazo_entrega_dias} dias</Celula>
              <Celula>{f.condicao_pagamento ?? "—"}</Celula>
              <Celula className="text-right">{pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${f.id}`}>Editar</LinkAcao>}</Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}
