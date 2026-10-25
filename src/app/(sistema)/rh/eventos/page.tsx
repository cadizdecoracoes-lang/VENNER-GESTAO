"use client";

import { Check, Plus } from "lucide-react";
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
import { FORMAS_CALCULO, TIPOS_EVENTO_FOLHA, type FormaCalculo, type TipoEventoFolha } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { salvarEvento } from "./actions";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "rh.eventos";

type Evento = {
  id: string;
  codigo: string;
  descricao: string;
  tipo: TipoEventoFolha;
  forma_calculo: FormaCalculo;
  incide_inss: boolean;
  incide_fgts: boolean;
  incide_irrf: boolean;
  observacao: string | null;
  ativo: boolean;
};

async function carregar(): Promise<Evento[]> {
  if (!supabaseConfigurado) return [];
  const supabase = criarClienteNavegador();
  const { data } = await supabase
    .from("eventos_folha")
    .select("id, codigo, descricao, tipo, forma_calculo, incide_inss, incide_fgts, incide_irrf, observacao, ativo")
    .order("codigo");
  return (data ?? []) as Evento[];
}

const COR_TIPO = { provento: "sucesso", desconto: "alerta", informativo: "neutra" } as const;

function Marca({ sim }: { sim: boolean }) {
  return sim ? (
    <Check size={16} className="mx-auto text-sucesso" aria-label="Sim" />
  ) : (
    <span className="block text-center text-texto-suave">—</span>
  );
}

async function PaginaEventos({ searchParams }: { searchParams: Promise<{ editar?: string; novo?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const { editar, novo } = await searchParams;
  const eventos = await carregar();
  const emEdicao = editar ? eventos.find((e) => e.id === editar) : undefined;
  const mostrarForm = (novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo evento
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.codigo} ${emEdicao.descricao}` : "Novo evento do holerite"}>
          <FormAcao key={emEdicao?.id ?? "novo"} acao={salvarEvento.bind(null, emEdicao?.id ?? null)} rotulo="Salvar" className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Campo rotulo="Código" dica="O mesmo do holerite da contabilidade.">
                <input name="codigo" required defaultValue={emEdicao?.codigo} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Descrição" className="lg:col-span-3">
                <input name="descricao" required defaultValue={emEdicao?.descricao} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Tipo">
                <select name="tipo" required defaultValue={emEdicao?.tipo ?? "provento"} className={estiloCampo}>
                  {Object.entries(TIPOS_EVENTO_FOLHA).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Informado em">
                <select name="forma_calculo" defaultValue={emEdicao?.forma_calculo ?? "valor"} className={estiloCampo}>
                  {Object.entries(FORMAS_CALCULO).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo rotulo="Observação" className="sm:col-span-2">
                <input name="observacao" defaultValue={emEdicao?.observacao ?? ""} className={estiloCampo} />
              </Campo>
            </div>
            <fieldset className="space-y-2 text-sm">
              <legend className="text-texto-suave">Entra na base de cálculo de</legend>
              <p className="text-xs text-texto-suave">Eventos informativos não entram em nenhuma base.</p>
              <div className="flex flex-wrap gap-6">
                {(
                  [
                    ["incide_inss", "INSS"],
                    ["incide_fgts", "FGTS"],
                    ["incide_irrf", "IRRF"],
                  ] as const
                ).map(([campo, rotulo]) => (
                  <label key={campo} className="flex items-center gap-2">
                    <input type="checkbox" name={campo} defaultChecked={emEdicao?.[campo] ?? false} />
                    {rotulo}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao?.ativo ?? true} />
                Evento ativo
              </label>
              <Link href="/rh/eventos" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Filtro
        atalhos={[
          { rotulo: "Tipo", opcoes: Object.entries(TIPOS_EVENTO_FOLHA).map(([valor, rotulo]) => ({ valor, rotulo })) },
          ATALHO_SITUACAO,
        ]}
      >
        <Tabela colunas={["Código", "Evento", "Tipo", "Informado em", "INSS", "FGTS", "IRRF", ""]} vazio="Nenhum evento cadastrado ainda.">
          {eventos.map((e) => (
            <tr key={e.id} data-tags={`${e.tipo} ${e.ativo ? "ativo" : "inativo"}`} className={e.ativo ? "" : "text-texto-suave"}>
              <Celula className="font-medium tabular-nums">{e.codigo}</Celula>
              <Celula>
                {e.descricao} {!e.ativo && <Etiqueta>Inativo</Etiqueta>}
                {e.observacao && <span className="block text-xs text-texto-suave">{e.observacao}</span>}
              </Celula>
              <Celula>
                <Etiqueta cor={COR_TIPO[e.tipo]}>{TIPOS_EVENTO_FOLHA[e.tipo]}</Etiqueta>
              </Celula>
              <Celula>{FORMAS_CALCULO[e.forma_calculo]}</Celula>
              <Celula>
                <Marca sim={e.incide_inss} />
              </Celula>
              <Celula>
                <Marca sim={e.incide_fgts} />
              </Celula>
              <Celula>
                <Marca sim={e.incide_irrf} />
              </Celula>
              <Celula className="text-right">{pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${e.id}`}>Editar</LinkAcao>}</Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaEventos} />;
}
