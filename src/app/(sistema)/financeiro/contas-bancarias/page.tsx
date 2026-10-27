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
import { carregarEmpresas, empresaSelecionada } from "@/lib/empresa";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { TIPOS_CONTA_BANCARIA, type TipoContaBancaria } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { salvarConta } from "./actions";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "financeiro.contas_bancarias";

type Conta = {
  id: string;
  empresa_id: string;
  nome: string;
  tipo: TipoContaBancaria;
  banco_codigo: string | null;
  banco_nome: string | null;
  agencia: string | null;
  conta: string | null;
  saldo_inicial: number;
  data_saldo_inicial: string;
  ativa: boolean;
};
type Filtros = { editar?: string; novo?: string };

async function carregar(empresa: string | null): Promise<Conta[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  let consulta = supabase
    .from("contas_bancarias")
    .select("id, empresa_id, nome, tipo, banco_codigo, banco_nome, agencia, conta, saldo_inicial, data_saldo_inicial, ativa")
    .order("nome");
  if (empresa) consulta = consulta.eq("empresa_id", empresa);
  const { data } = await consulta;
  return (data ?? []) as Conta[];
}

async function PaginaContasBancarias({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const [empresas, selecionada] = await Promise.all([carregarEmpresas(), empresaSelecionada()]);
  const contas = await carregar(selecionada?.id ?? null);
  // No consolidado, um bloco por empresa (na ordem do seletor) com subtotal.
  const blocos = (selecionada ? [selecionada] : empresas)
    .map((e) => ({ empresa: e, contas: contas.filter((c) => c.empresa_id === e.id) }))
    .filter((b) => b.contas.length > 0);
  const soma = (lista: Conta[]) => lista.filter((c) => c.ativa).reduce((t, c) => t + Number(c.saldo_inicial), 0);
  const emEdicao = filtros.editar ? contas.find((c) => c.id === filtros.editar) : undefined;
  const mostrarForm = (filtros.novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} empresa={selecionada}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Nova conta
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome}` : "Nova conta bancária"}>
          <FormAcao key={emEdicao?.id ?? "novo"} acao={salvarConta.bind(null, emEdicao?.id ?? null)} rotulo="Salvar" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Empresa (CNPJ)" className="sm:col-span-2">
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
              <Campo rotulo="Nome da conta" dica="Como aparece nas telas, ex.: Itaú movimento.">
                <input name="nome" required defaultValue={emEdicao?.nome} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Tipo">
                <select name="tipo" defaultValue={emEdicao?.tipo ?? "corrente"} className={estiloCampo}>
                  {Object.entries(TIPOS_CONTA_BANCARIA).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Código do banco" dica="3 números, ex.: 341.">
                <input
                  name="banco_codigo"
                  inputMode="numeric"
                  maxLength={3}
                  defaultValue={emEdicao?.banco_codigo ?? ""}
                  className={estiloCampo}
                />
              </Campo>
              <Campo rotulo="Banco">
                <input name="banco_nome" defaultValue={emEdicao?.banco_nome ?? ""} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Agência">
                <input name="agencia" defaultValue={emEdicao?.agencia ?? ""} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Conta">
                <input name="conta" defaultValue={emEdicao?.conta ?? ""} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Saldo inicial (R$)" dica="Saldo do extrato na data ao lado. Ponto de partida da conciliação.">
                <input name="saldo_inicial" inputMode="decimal" defaultValue={emEdicao?.saldo_inicial ?? 0} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Data do saldo inicial">
                <input
                  name="data_saldo_inicial"
                  type="date"
                  required
                  defaultValue={emEdicao?.data_saldo_inicial ?? hoje}
                  className={estiloCampo}
                />
              </Campo>
            </div>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativa" defaultChecked={emEdicao?.ativa ?? true} />
                Conta ativa
              </label>
              <Link href="/financeiro/contas-bancarias" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}


      <Filtro
        atalhos={[
          { rotulo: "Tipo", opcoes: Object.entries(TIPOS_CONTA_BANCARIA).map(([valor, rotulo]) => ({ valor, rotulo })) },
          ATALHO_SITUACAO,
        ]}
        placeholder="Filtrar por conta, banco, agência..."
      >
        <div className="space-y-3">
          {blocos.length === 0 && (
            <Tabela
              colunas={["Conta", "Banco", "Agência / conta", "Saldo inicial", ""]}
              vazio={selecionada ? "Nenhuma conta nesta empresa." : "Nenhuma conta bancária cadastrada ainda."}
            >
              {[]}
            </Tabela>
          )}
          {blocos.map(({ empresa, contas: daEmpresa }) => (
            <div key={empresa.id} data-bloco-filtro>
              <Cartao
                titulo={empresa.nome}
                acoes={<span className="text-xs tabular-nums text-texto-suave">Saldos iniciais: {formatarMoeda(soma(daEmpresa))}</span>}
              >
                <Tabela embutida colunas={["Conta", "Banco", "Agência / conta", "Saldo inicial", ""]}>
                  {daEmpresa.map((c) => (
                    <tr key={c.id} data-tags={`${c.tipo} ${c.ativa ? "ativo" : "inativo"}`} className={c.ativa ? "" : "text-texto-suave"}>
                      <Celula>
                        <span className="font-medium">{c.nome}</span>
                        <span className="text-xs text-texto-suave"> · {TIPOS_CONTA_BANCARIA[c.tipo]}</span> {!c.ativa && <Etiqueta>Inativa</Etiqueta>}
                      </Celula>
                      <Celula>{[c.banco_codigo, c.banco_nome].filter(Boolean).join(" · ") || "—"}</Celula>
                      <Celula className="tabular-nums">{[c.agencia, c.conta].filter(Boolean).join(" / ") || "—"}</Celula>
                      <Celula className="whitespace-nowrap tabular-nums">
                        {formatarMoeda(c.saldo_inicial)}
                        <span className="text-xs text-texto-suave"> em {formatarData(c.data_saldo_inicial)}</span>
                      </Celula>
                      <Celula className="text-right">
                        {pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${c.id}`}>Editar</LinkAcao>}
                      </Celula>
                    </tr>
                  ))}
                </Tabela>
              </Cartao>
            </div>
          ))}
        </div>
      </Filtro>

      {!selecionada && blocos.length > 1 && (
        <div className="flex justify-between rounded-xl bg-superficie px-4 py-2 text-sm font-medium shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
          <span>Saldos iniciais do grupo ({blocos.length} empresas)</span>
          <span className="tabular-nums">{formatarMoeda(soma(contas))}</span>
        </div>
      )}
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaContasBancarias} />;
}
