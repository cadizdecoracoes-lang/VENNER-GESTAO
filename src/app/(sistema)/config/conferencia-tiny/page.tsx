"use client";

import { CabecalhoTela, Celula, Etiqueta, SemAcesso, Tabela } from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { BASE_RESUMO, NOME_MODULO, type Diferenca, type ModuloConferencia } from "@/lib/conferencia-tiny";
import { empresaSelecionada } from "@/lib/empresa";
import { formatarDataHora, formatarMoeda } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { TelaCliente } from "@/components/tela-cliente";
import { ListaDiferencas } from "./lista";

const TELA = "config.conferencia_tiny";

type Resumo = {
  empresa_id: string;
  modulo: ModuloConferencia;
  tiny_qtd: number | null;
  tiny_valor: number | null;
  venner_qtd: number | null;
  venner_valor: number | null;
  so_aqui_qtd: number | null;
  lido_em: string | null;
};
type Conta = { empresa_id: string; executado_em: string | null; ok_em: string | null; ultimo_erro: string | null };

const AJUDA = (
  <>
    <p>
      Compara o que o robô leu do Tiny (a cada minuto) com o que está no sistema, módulo por módulo. Não precisa de planilha: a
      conferência se refaz sozinha a cada leitura.
    </p>
    <p className="mt-2">
      <b>Falta aqui</b>: está no Tiny e não no sistema. <b>Sobra aqui</b>: está no sistema ligado ao Tiny, mas o Tiny não tem mais.{" "}
      <b>Diferente</b>: situação, valor ou vencimento não batem. <b>Lançado só aqui</b>: criado no sistema, sem número do Tiny (confira
      se não é repetido).
    </p>
    <p className="mt-2">
      &quot;Deixar igual ao Tiny&quot; tira a proteção do que foi alterado ou excluído aqui e o robô relê do Tiny em até 1 minuto. Título
      conciliado com o extrato nunca muda. Notas fiscais só aparecem aqui para conferência.
    </p>
  </>
);

const qtd = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR"));
const valor = (n: number | null) => (n === null ? "" : formatarMoeda(Number(n)));

async function PaginaConferenciaTiny() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const selecionada = await empresaSelecionada();
  const supabase = supabaseConfigurado ? criarClienteNavegador() : null;
  const [contas, resumo, diferencas] = supabase
    ? await Promise.all([
        supabase.rpc("situacao_tiny").then((r) => (r.data ?? []) as Conta[]),
        supabase.rpc("conferencia_tiny_resumo").then((r) => (r.data ?? []) as Resumo[]),
        supabase.rpc("conferencia_tiny").then((r) => (r.data ?? []) as Diferenca[]),
      ])
    : [[], [], []];
  const daEmpresa = <T extends { empresa_id: string }>(l: T[]) => (selecionada ? l.filter((x) => x.empresa_id === selecionada.id) : l);
  const lista = daEmpresa(diferencas);
  const conta = daEmpresa(contas)[0];
  const porModulo = (m: ModuloConferencia) => lista.filter((d) => d.modulo === m && d.problema !== "so_aqui").length;
  const agora = Date.now();
  const atrasado = conta?.ok_em ? agora - Date.parse(conta.ok_em) > 10 * 60_000 : true;

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA} empresa={selecionada} ajuda={AJUDA}>
        {conta ? (
          <span className="flex items-center gap-2 text-xs text-texto-suave" title={conta.ultimo_erro ?? undefined}>
            {conta.ultimo_erro ? (
              <Etiqueta cor="alerta">Leitura com erro</Etiqueta>
            ) : atrasado ? (
              <Etiqueta cor="alerta">Leitura parada</Etiqueta>
            ) : (
              <Etiqueta cor="sucesso">Lendo o Tiny</Etiqueta>
            )}
            Última leitura sem erro: {formatarDataHora(conta.ok_em)}
          </span>
        ) : (
          <Etiqueta cor="alerta">Tiny não ligado</Etiqueta>
        )}
      </CabecalhoTela>

      {conta?.ultimo_erro && <p className="rounded-lg bg-perigo/10 px-3 py-1.5 text-sm text-perigo">{conta.ultimo_erro}</p>}

      <Tabela
        colunas={["Módulo", "No Tiny", "Aqui", "Diferenças", "Só aqui", "Lido do Tiny em"]}
        vazio={supabase ? "Nenhuma conta do Tiny ligada para esta empresa." : "Banco não conectado (modo de demonstração)."}
      >
        {daEmpresa(resumo).map((r) => (
          <tr key={`${r.empresa_id}:${r.modulo}`}>
            <Celula className="whitespace-nowrap font-medium">{NOME_MODULO[r.modulo]}</Celula>
            <Celula className="whitespace-nowrap tabular-nums">
              <span title={BASE_RESUMO[r.modulo].tiny}>{qtd(r.tiny_qtd)}</span>{" "}
              <span className="text-xs text-texto-suave">{valor(r.tiny_valor)}</span>
            </Celula>
            <Celula className="whitespace-nowrap tabular-nums">
              <span title={BASE_RESUMO[r.modulo].venner}>{qtd(r.venner_qtd)}</span>{" "}
              <span className="text-xs text-texto-suave">{valor(r.venner_valor)}</span>
            </Celula>
            <Celula className="tabular-nums">
              {porModulo(r.modulo) ? <span className="font-semibold text-perigo">{porModulo(r.modulo)}</span> : <span className="text-sucesso">Igual</span>}
            </Celula>
            <Celula className="tabular-nums text-texto-suave">{r.so_aqui_qtd ? r.so_aqui_qtd : "—"}</Celula>
            <Celula className="whitespace-nowrap text-xs text-texto-suave">{r.lido_em ? formatarDataHora(r.lido_em) : "Ainda não lido"}</Celula>
          </tr>
        ))}
      </Tabela>

      <ListaDiferencas lista={lista} corrigir={pode(acesso, TELA, "editar")} />
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaConferenciaTiny} />;
}
