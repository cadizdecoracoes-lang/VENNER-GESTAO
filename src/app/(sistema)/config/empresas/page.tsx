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
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { formatarCnpj, formatarData } from "@/lib/formato";
import { ATIVIDADES, REGIMES, type Regime } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarEmpresa } from "./actions";

const TELA = "config.empresas";

type Empresa = {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string;
  regime_tributario: Regime;
  atividades: string[];
  ativa: boolean;
};

type Historico = { regime_tributario: Regime; vigencia_inicio: string };

async function carregar(editar?: string) {
  if (!supabaseConfigurado) return { empresas: [] as Empresa[], historico: [] as Historico[] };
  const supabase = await criarClienteServidor();
  const [{ data: empresas }, { data: historico }] = await Promise.all([
    supabase.from("empresas").select("id, razao_social, nome_fantasia, cnpj, regime_tributario, atividades, ativa").order("razao_social"),
    editar
      ? supabase
          .from("empresas_regime_historico")
          .select("regime_tributario, vigencia_inicio")
          .eq("empresa_id", editar)
          .order("vigencia_inicio", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  return { empresas: (empresas ?? []) as Empresa[], historico: (historico ?? []) as Historico[] };
}

export default async function PaginaEmpresas({ searchParams }: { searchParams: Promise<{ editar?: string; novo?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const { editar, novo } = await searchParams;
  const { empresas, historico } = await carregar(editar);
  const emEdicao = editar ? empresas.find((e) => e.id === editar) : undefined;
  const mostrarForm = (novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Nova empresa
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao titulo={emEdicao ? `Editar ${emEdicao.nome_fantasia ?? emEdicao.razao_social}` : "Nova empresa"}>
          <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
            <FormAcao
              key={emEdicao?.id ?? "nova"}
              acao={salvarEmpresa.bind(null, emEdicao?.id ?? null)}
              rotulo="Salvar"
              className="space-y-4"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Razão social">
                  <input name="razao_social" required defaultValue={emEdicao?.razao_social} className={estiloCampo} />
                </Campo>
                <Campo rotulo="Nome fantasia" dica="É o nome que aparece no seletor de empresa.">
                  <input name="nome_fantasia" defaultValue={emEdicao?.nome_fantasia ?? ""} className={estiloCampo} />
                </Campo>
                <Campo rotulo="CNPJ">
                  <input
                    name="cnpj"
                    required
                    inputMode="numeric"
                    placeholder="00.000.000/0000-00"
                    defaultValue={emEdicao ? formatarCnpj(emEdicao.cnpj) : ""}
                    className={estiloCampo}
                  />
                </Campo>
                <Campo rotulo="Regime tributário" dica="Toda troca fica registrada com a data, para a visão tributária.">
                  <select name="regime_tributario" required defaultValue={emEdicao?.regime_tributario ?? ""} className={estiloCampo}>
                    <option value="" disabled>
                      Escolha...
                    </option>
                    {Object.entries(REGIMES).map(([v, r]) => (
                      <option key={v} value={v}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
              <fieldset className="space-y-2 text-sm">
                <legend className="text-texto-suave">Atividades</legend>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(ATIVIDADES).map(([v, r]) => (
                    <label key={v} className="flex items-center gap-2">
                      <input type="checkbox" name="atividades" value={v} defaultChecked={emEdicao?.atividades.includes(v)} />
                      {r}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativa" defaultChecked={emEdicao?.ativa ?? true} />
                Empresa ativa
              </label>
            </FormAcao>

            <div className="space-y-3">
              {emEdicao && (
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Histórico de regime</p>
                  {historico.length === 0 && <p className="text-texto-suave">Sem registros.</p>}
                  <ul className="space-y-1">
                    {historico.map((h) => (
                      <li key={h.vigencia_inicio} className="flex justify-between gap-2">
                        <span>{REGIMES[h.regime_tributario]}</span>
                        <span className="text-texto-suave">desde {formatarData(h.vigencia_inicio)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Link href="/config/empresas" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </div>
        </Cartao>
      )}

      <Filtro
        atalhos={[
          { rotulo: "Regime", opcoes: Object.entries(REGIMES).map(([valor, rotulo]) => ({ valor, rotulo })) },
          {
            rotulo: "Situação",
            opcoes: [
              { valor: "ativo", rotulo: "Ativas" },
              { valor: "inativo", rotulo: "Inativas" },
            ],
          },
        ]}
      >
        <Tabela colunas={["Empresa", "CNPJ", "Regime", "Atividades", "Situação", ""]} vazio="Nenhuma empresa cadastrada ainda.">
          {empresas.map((e) => (
            <tr key={e.id} data-tags={`${e.regime_tributario} ${e.ativa ? "ativo" : "inativo"}`}>
              <Celula>
                <div className="font-medium">{e.nome_fantasia ?? e.razao_social}</div>
                {e.nome_fantasia && <div className="text-xs text-texto-suave">{e.razao_social}</div>}
              </Celula>
              <Celula className="tabular-nums">{formatarCnpj(e.cnpj)}</Celula>
              <Celula>
                <Etiqueta cor={e.regime_tributario === "simples_nacional" ? "sucesso" : "primaria"}>
                  {REGIMES[e.regime_tributario]}
                </Etiqueta>
              </Celula>
              <Celula className="text-texto-suave">
                {e.atividades.map((a) => ATIVIDADES[a as keyof typeof ATIVIDADES] ?? a).join(", ") || "—"}
              </Celula>
              <Celula>{e.ativa ? <Etiqueta cor="sucesso">Ativa</Etiqueta> : <Etiqueta>Inativa</Etiqueta>}</Celula>
              <Celula className="text-right">{pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${e.id}`}>Editar</LinkAcao>}</Celula>
            </tr>
          ))}
        </Tabela>
      </Filtro>
    </div>
  );
}
