"use client";

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
import { CANAIS, type Canal } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { salvarCliente } from "./actions";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "vendas.clientes";
const CAMPOS = "id, tipo_pessoa, documento, nome, nome_fantasia, email, telefone, cidade, uf, observacao, ativo, canal";

type Cliente = DadosPessoa & { id: string; canal: Canal };
type Filtros = { editar?: string; novo?: string };

async function carregar(): Promise<Cliente[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const consulta = supabase.from("clientes").select(CAMPOS).order("nome").limit(2000);
  const { data } = await consulta;
  return (data ?? []) as Cliente[];
}

async function buscar(id: string): Promise<Cliente | undefined> {
  if (!supabaseConfigurado) return undefined;
  const supabase = criarClienteNavegador();
  const { data } = await supabase.from("clientes").select(CAMPOS).eq("id", id).maybeSingle();
  return (data as Cliente | null) ?? undefined;
}

async function PaginaClientees({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const clientes = await carregar();
  const emEdicao = filtros.editar ? (clientes.find((f) => f.id === filtros.editar) ?? (await buscar(filtros.editar))) : undefined;
  const mostrarForm = (filtros.novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo cliente
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome}` : "Novo cliente"}>
          <FormAcao
            key={emEdicao?.id ?? "novo"}
            acao={salvarCliente.bind(null, emEdicao?.id ?? null)}
            rotulo="Salvar"
            className="space-y-4"
          >
            <CamposPessoa valor={emEdicao} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Canal de venda">
                <select name="canal" defaultValue={emEdicao?.canal ?? "venda_direta"} className={estiloCampo}>
                  {Object.entries(CANAIS).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Observação" className="sm:col-span-1 lg:col-span-3">
                <input name="observacao" defaultValue={emEdicao?.observacao ?? ""} className={estiloCampo} />
              </Campo>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao?.ativo ?? true} />
                Cliente ativo
              </label>
              <Link href="/vendas/clientes" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Filtro
        atalhos={[{ rotulo: "Canal", opcoes: Object.entries(CANAIS).map(([valor, rotulo]) => ({ valor, rotulo })) }, ATALHO_SITUACAO]}
        placeholder="Filtrar por nome, CNPJ/CPF, cidade, UF..."
      >
        <Tabela colunas={["Cliente", "CNPJ / CPF", "Cidade", "Contato", "Canal", ""]} vazio="Nenhum cliente cadastrado ainda.">
          {clientes.map((f) => (
            <tr key={f.id} data-tags={`${f.canal} ${f.ativo ? "ativo" : "inativo"}`} className={f.ativo ? "" : "text-texto-suave"}>
              <Celula>
                <span className="font-medium">{f.nome_fantasia ?? f.nome}</span> {!f.ativo && <Etiqueta>Inativo</Etiqueta>}
                {f.nome_fantasia && <span className="block text-xs text-texto-suave">{f.nome}</span>}
              </Celula>
              <Celula className="whitespace-nowrap tabular-nums">{formatarDocumento(f.documento)}</Celula>
              <Celula>{[f.cidade, f.uf].filter(Boolean).join(" / ") || "—"}</Celula>
              <Celula className="text-texto-suave">{[f.telefone, f.email].filter(Boolean).join(" · ") || "—"}</Celula>
              <Celula>{CANAIS[f.canal]}</Celula>
              <Celula className="text-right">{pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${f.id}`}>Editar</LinkAcao>}</Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaClientees} />;
}
