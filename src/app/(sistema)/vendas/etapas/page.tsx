import { Plus } from "lucide-react";
import Link from "next/link";
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
import { FASES_PEDIDO, type FasePedido } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarEtapa } from "./actions";

const TELA = "vendas.etapas";

type Etapa = { id: string; nome: string; ordem: number; fase: FasePedido; ativa: boolean };

// O que cada fase significa para o sistema.
const EXPLICACAO: Record<FasePedido, string> = {
  negociacao: "Ainda não confirmado: não entra na produção nem nas compras.",
  producao: "Confirmado e por produzir: entra na necessidade de materiais e na fila de produção.",
  expedicao: "Pronto: aguardando coleta ou a caminho do cliente.",
  encerrado: "Entregue ou cancelado: sai do funil.",
};

export default async function PaginaEtapas({ searchParams }: { searchParams: Promise<{ editar?: string; novo?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const { editar, novo } = await searchParams;

  let etapas: Etapa[] = [];
  if (supabaseConfigurado) {
    const supabase = await criarClienteServidor();
    etapas = ((await supabase.from("etapas_pedido").select("id, nome, ordem, fase, ativa").order("ordem")).data ?? []) as Etapa[];
  }
  const emEdicao = editar ? etapas.find((e) => e.id === editar) : undefined;
  const mostrarForm = (novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));
  const proximaOrdem = (etapas.at(-1)?.ordem ?? 0) + 10;

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Nova etapa
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome}` : "Nova etapa"}>
          <FormAcao key={emEdicao?.id ?? "novo"} acao={salvarEtapa.bind(null, emEdicao?.id ?? null)} rotulo="Salvar" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo rotulo="Nome" className="sm:col-span-2">
                <input name="nome" required defaultValue={emEdicao?.nome} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Ordem" dica="Posição no funil (10, 20, 30...).">
                <input name="ordem" type="number" required defaultValue={emEdicao?.ordem ?? proximaOrdem} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Fase">
                <select name="fase" defaultValue={emEdicao?.fase ?? "producao"} className={estiloCampo}>
                  {Object.entries(FASES_PEDIDO).map(([v, r]) => (
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
                Etapa ativa
              </label>
              <Link href="/vendas/etapas" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Tabela colunas={["Ordem", "Etapa", "Fase", ""]} vazio="Nenhuma etapa cadastrada.">
        {etapas.map((e) => (
          <tr key={e.id} className={e.ativa ? "" : "text-texto-suave"}>
            <Celula className="tabular-nums text-texto-suave">{e.ordem}</Celula>
            <Celula className="font-medium">
              {e.nome} {!e.ativa && <Etiqueta>Inativa</Etiqueta>}
            </Celula>
            <Celula>
              <Etiqueta
                cor={e.fase === "producao" ? "primaria" : e.fase === "encerrado" ? "neutra" : e.fase === "expedicao" ? "sucesso" : "alerta"}
              >
                {FASES_PEDIDO[e.fase]}
              </Etiqueta>
              <span className="mt-0.5 block text-xs text-texto-suave">{EXPLICACAO[e.fase]}</span>
            </Celula>
            <Celula className="text-right">{pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${e.id}`}>Editar</LinkAcao>}</Celula>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
