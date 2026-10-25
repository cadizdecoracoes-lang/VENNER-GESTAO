import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Campo,
  Cartao,
  Celula,
  Etiqueta,
  Fonte,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil, somarDias } from "@/lib/datas";
import { carregarEmpresas } from "@/lib/empresa";
import { carregarLocais } from "@/lib/financeiro";
import { NOME_CANAL, type Canal } from "@/lib/plataformas/tipos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { chamarFuncao } from "@/lib/supabase/funcoes";
import { criarClienteServidor } from "@/lib/supabase/server";
import { buscarVendas, escolherLocal, removerConta } from "./actions";
import { type AplicativoTiny, CartaoTiny, type ContaTiny } from "./cartao-tiny";
import { ConcluirLigacao, LigarConta, type VoltaDaPlataforma } from "./ligar-conta";

const TELA = "config.integracoes";
const GUIA = "https://claude.ai/artifact/ABp37XYcittjSNPYVoNULc";

type Conta = {
  id: string;
  empresa_id: string;
  canal: Canal | "tiny";
  conta_externa: string;
  apelido: string | null;
  expira_em: string | null;
  ultima_sincronizacao: string | null;
  local_baixa_id: string | null;
};
type Filtros = Partial<VoltaDaPlataforma> & {
  ligada?: string;
  erro?: string;
  importadas?: string;
  repetidas?: string;
  puladas?: string;
  sem_anuncio?: string;
};
// O que a Edge Function integracoes informa: chaves dos aplicativos guardadas e endereços de retorno.
type Situacao = Record<Canal, boolean> & { retorno: Record<Canal | "tiny", string> };

const DIAS_PADRAO: Record<Canal, number> = { mercado_livre: 15, shopee: 10 };

export default async function PaginaIntegracoes({ searchParams }: { searchParams: Promise<Filtros> }) {
  const acesso = await carregarAcesso();
  const ligar = pode(acesso, TELA, "editar") || pode(acesso, "financeiro.receber", "criar");
  if (!pode(acesso, TELA, "ver") && !ligar) return <SemAcesso codigo={TELA} />;

  const filtros = await searchParams;
  const [empresas, locais] = await Promise.all([carregarEmpresas(), carregarLocais()]);
  const supabase = supabaseConfigurado ? await criarClienteServidor() : null;
  const [listadas, aplicativos, contasTiny] = supabase
    ? await Promise.all([
        supabase.rpc("listar_integracoes").then((r) => (r.data ?? []) as Conta[]),
        supabase.rpc("aplicativo_tiny").then((r) => (r.data ?? []) as AplicativoTiny[]),
        supabase.rpc("situacao_tiny").then((r) => (r.data ?? []) as ContaTiny[]),
      ])
    : [[], [], []];
  // O Tiny tem cartão próprio; a tabela é das lojas (Mercado Livre e Shopee).
  const contas = listadas.filter((c): c is Conta & { canal: Canal } => c.canal !== "tiny");
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const nomeLocal = new Map(locais.map((l) => [l.id, l.nome]));
  const hoje = hojeBrasil();
  const situacao = supabase ? await chamarFuncao<Situacao>(supabase, "integracoes", { acao: "situacao" }).catch(() => null) : null;
  const configurado: Record<Canal, boolean> = { mercado_livre: !!situacao?.mercado_livre, shopee: !!situacao?.shopee };
  const semAnuncio = filtros.sem_anuncio?.split(",").filter(Boolean) ?? [];

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA} />

      {filtros.ligacao && ligar && <ConcluirLigacao volta={{ ...filtros, ligacao: filtros.ligacao }} />}

      {filtros.ligada === "tiny" && (
        <p className="rounded-xl bg-sucesso/10 px-4 py-2.5 text-sm text-sucesso">
          Tiny ligado. A primeira leitura começa em até 5 minutos; a carga completa leva algumas horas.
        </p>
      )}
      {filtros.ligada && filtros.ligada !== "tiny" && (
        <p className="rounded-xl bg-sucesso/10 px-4 py-2.5 text-sm text-sucesso">
          Conta ligada. Escolha o local do estoque e busque as vendas.
        </p>
      )}
      {filtros.erro && <p className="rounded-xl bg-perigo/10 px-4 py-2.5 text-sm text-perigo">{filtros.erro}</p>}
      {filtros.importadas !== undefined && (
        <div className="rounded-xl bg-sucesso/10 px-4 py-2.5 text-sm text-sucesso">
          <p>
            {Number(filtros.importadas)} vendas importadas
            {Number(filtros.repetidas) > 0 && ` · ${Number(filtros.repetidas)} já estavam no sistema`}.{" "}
            <LinkAcao href="/financeiro/receber">Ver no contas a receber</LinkAcao>
          </p>
          {semAnuncio.length > 0 && (
            <p className="mt-1 text-alerta">
              {Number(filtros.puladas)} vendas ficaram para depois porque estes anúncios ainda não têm produto: {semAnuncio.join(", ")}.{" "}
              <LinkAcao href="/vendas/anuncios?novo=1">Ligar anúncios</LinkAcao> e busque de novo.
            </p>
          )}
        </div>
      )}

      <CartaoTiny
        empresas={empresas}
        aplicativos={aplicativos}
        contas={contasTiny}
        editar={pode(acesso, TELA, "editar")}
        ligar={ligar}
        retorno={situacao?.retorno.tiny ?? null}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {(Object.keys(NOME_CANAL) as Canal[]).map((canal) => (
          <Cartao
            key={canal}
            titulo={NOME_CANAL[canal]}
            acoes={
              configurado[canal] ? (
                <Etiqueta cor="sucesso">App configurado</Etiqueta>
              ) : (
                <Etiqueta cor="alerta">Aguardando as chaves</Etiqueta>
              )
            }
          >
            {!configurado[canal] ? (
              <p className="text-sm text-texto-suave">
                Falta criar o aplicativo na plataforma e guardar as chaves nos segredos das Edge Functions do Supabase. O passo a passo
                está no{" "}
                <a href={GUIA} target="_blank" rel="noreferrer" className="text-primaria hover:underline">
                  guia de ligação
                </a>
                . Enquanto isso, as vendas entram pela planilha em{" "}
                <LinkAcao href="/financeiro/receber/importar">Contas a receber › Importar vendas</LinkAcao>.
                {situacao && (
                  <span className="mt-2 block text-xs">
                    Endereço de retorno para cadastrar no aplicativo:{" "}
                    <code className="break-all">{situacao.retorno[canal]}</code>
                  </span>
                )}
              </p>
            ) : ligar ? (
              <LigarConta
                canal={canal}
                empresas={empresas}
                rotulo={canal === "mercado_livre" ? "Ligar conta do Mercado Livre" : "Ligar loja da Shopee"}
              />
            ) : (
              <p className="text-sm text-texto-suave">Seu perfil só acompanha as contas ligadas.</p>
            )}
            <p className="mt-3 text-xs text-texto-suave">
              A ligação só lê pedidos e repasses. Não mexe em anúncios, etiquetas, envios nem no contato com o cliente, e pode ser desfeita
              a qualquer momento na própria plataforma.
            </p>
          </Cartao>
        ))}
      </div>

      <Tabela
        colunas={["Plataforma", "Conta", "Empresa", "Estoque sai de", "Última busca", "Buscar vendas", ""]}
        vazio="Nenhuma conta ligada ainda."
      >
        {contas.map((c) => {
          const desde = c.ultima_sincronizacao ? somarDias(c.ultima_sincronizacao.slice(0, 10), -3) : somarDias(hoje, -30);
          return (
            <tr key={c.id}>
              <Celula>
                <Etiqueta cor={c.canal === "mercado_livre" ? "alerta" : "primaria"}>{NOME_CANAL[c.canal]}</Etiqueta>
              </Celula>
              <Celula>
                <span className="font-medium">{c.apelido ?? c.conta_externa}</span>
                <span className="block text-xs text-texto-suave">nº {c.conta_externa}</span>
              </Celula>
              <Celula className="text-texto-suave">{nomeEmpresa.get(c.empresa_id) ?? "—"}</Celula>
              <Celula>
                {ligar ? (
                  <FormAcao
                    key={c.local_baixa_id ?? ""}
                    acao={escolherLocal.bind(null, c.id)}
                    rotulo="Salvar"
                    enviando="..."
                    secundario
                    className="flex items-center gap-2"
                  >
                    <select name="local" defaultValue={c.local_baixa_id ?? ""} className={estiloCampo}>
                      <option value="" disabled>
                        Escolha...
                      </option>
                      {locais.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.nome}
                        </option>
                      ))}
                    </select>
                  </FormAcao>
                ) : (
                  (nomeLocal.get(c.local_baixa_id ?? "") ?? "—")
                )}
              </Celula>
              <Celula className="whitespace-nowrap text-texto-suave">
                {c.ultima_sincronizacao
                  ? new Date(c.ultima_sincronizacao).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : "Nunca"}
              </Celula>
              <Celula>
                {ligar && (
                  <FormAcao acao={buscarVendas.bind(null, c.id)} rotulo="Buscar vendas agora" enviando="Buscando..." className="space-y-2">
                    <div className="flex gap-2">
                      <label className="text-xs text-texto-suave">
                        Desde
                        <input name="desde" type="date" defaultValue={desde} className={estiloCampo} />
                      </label>
                      <label className="text-xs text-texto-suave">
                        Dias p/ liberar
                        <input
                          name="dias"
                          type="number"
                          min={0}
                          max={120}
                          defaultValue={DIAS_PADRAO[c.canal]}
                          className={`${estiloCampo} w-20`}
                        />
                      </label>
                    </div>
                  </FormAcao>
                )}
              </Celula>
              <Celula className="text-right">
                {pode(acesso, TELA, "editar") && (
                  <FormAcao
                    acao={removerConta.bind(null, c.id)}
                    rotulo="Desligar"
                    enviando="..."
                    discreto
                    confirmar="Desligar esta conta do sistema? As vendas já importadas continuam. Para tirar a autorização na plataforma, faça também por lá."
                  />
                )}
              </Celula>
            </tr>
          );
        })}
      </Tabela>
      <Fonte>
        Contas ligadas às empresas que você vê. A busca traz as vendas pagas desde a data escolhida (sugerida: 3 dias antes da última busca)
        e não repete vendas já importadas. O vencimento do título é a data de liberação do dinheiro informada pela plataforma; sem ela, a
        data da venda + os dias para liberar.
      </Fonte>
    </div>
  );
}
