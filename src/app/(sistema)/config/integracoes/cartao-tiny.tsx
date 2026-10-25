import { FormAcao } from "@/components/form-acao";
import { Campo, Cartao, Etiqueta, LinkAcao, estiloBotao, estiloCampo } from "@/components/ui";
import type { EmpresaResumo } from "@/lib/empresa";
import { ajustarPagarTiny, lerTinyAgora, removerConta, salvarChavesTiny } from "./actions";

export type AplicativoTiny = { empresa_id: string; client_id: string; atualizado_em: string };
export type ContaTiny = {
  id: string;
  empresa_id: string;
  apelido: string | null;
  ligada_em: string;
  executado_em: string | null;
  ok_em: string | null;
  ultimo_erro: string | null;
  ler_pagar_ate: string | null;
  pendentes: Partial<Record<"receber" | "pagar" | "pedido" | "produto", number>>;
  falhas: number;
  importados: { receber: number; pagar: number; pedidos: number; produtos: number };
};

const quando = (v: string | null) =>
  v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }) : "Nunca";

export function CartaoTiny({
  empresas,
  aplicativos,
  contas,
  editar,
  ligar,
}: {
  empresas: EmpresaResumo[];
  aplicativos: AplicativoTiny[];
  contas: ContaTiny[];
  editar: boolean;
  ligar: boolean;
}) {
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const comChaves = empresas.filter((e) => aplicativos.some((a) => a.empresa_id === e.id));
  const pendentes = (c: ContaTiny) => Object.values(c.pendentes).reduce((s, n) => s + (n ?? 0), 0);

  return (
    <Cartao
      titulo="Tiny (Olist ERP)"
      acoes={
        contas.length ? (
          <Etiqueta cor="sucesso">Ligado</Etiqueta>
        ) : aplicativos.length ? (
          <Etiqueta cor="alerta">Falta ligar a conta</Etiqueta>
        ) : (
          <Etiqueta cor="alerta">Aguardando as chaves</Etiqueta>
        )
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-texto-suave">
          A cada 5 minutos o sistema lê do Tiny os pedidos de venda, as contas a receber, os produtos e, até a data escolhida, as contas a
          pagar (carga inicial). A ligação só lê: não altera nada no Tiny.
        </p>

        {contas.map((c) => (
          <div key={c.id} className="space-y-3 rounded-xl border border-borda p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                {nomeEmpresa.get(c.empresa_id) ?? "—"}
                <span className="ml-2 text-xs font-normal text-texto-suave">conta {c.apelido ?? "Tiny"}</span>
              </p>
              {c.ultimo_erro ? <Etiqueta cor="alerta">Com erro</Etiqueta> : <Etiqueta cor="sucesso">Lendo</Etiqueta>}
            </div>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <dt className="text-texto-suave">Última leitura</dt>
              <dd>{quando(c.executado_em)}</dd>
              <dt className="text-texto-suave">Última leitura sem erro</dt>
              <dd>{quando(c.ok_em)}</dd>
              <dt className="text-texto-suave">Já no sistema</dt>
              <dd>
                <LinkAcao href="/vendas/pedidos">{c.importados.pedidos} pedidos</LinkAcao> ·{" "}
                <LinkAcao href="/financeiro/receber">{c.importados.receber} a receber</LinkAcao> ·{" "}
                <LinkAcao href="/financeiro/pagar">{c.importados.pagar} a pagar</LinkAcao> · {c.importados.produtos} produtos
              </dd>
              <dt className="text-texto-suave">Na fila para ler</dt>
              <dd>
                {pendentes(c) === 0
                  ? "Nada"
                  : `${pendentes(c)} (${c.pendentes.pedido ?? 0} pedidos, ${c.pendentes.receber ?? 0} a receber, ${c.pendentes.pagar ?? 0} a pagar, ${c.pendentes.produto ?? 0} produtos)`}
                {c.falhas > 0 && <span className="block text-xs text-alerta">{c.falhas} registros não puderam ser lidos depois de 5 tentativas.</span>}
              </dd>
            </dl>
            {c.ultimo_erro && <p className="rounded-lg bg-perigo/10 px-3 py-2 text-perigo">{c.ultimo_erro}</p>}
            {ligar && (
              <div className="flex flex-wrap items-end gap-3">
                <FormAcao acao={lerTinyAgora.bind(null, c.id)} rotulo="Ler agora" enviando="Lendo o Tiny..." secundario />
                {editar && (
                  <FormAcao
                    key={c.ler_pagar_ate ?? ""}
                    acao={ajustarPagarTiny.bind(null, c.id)}
                    rotulo="Salvar"
                    enviando="..."
                    secundario
                    className="flex items-end gap-2"
                  >
                    <label className="text-xs text-texto-suave">
                      Ler contas a pagar até (vazio = não ler)
                      <input name="ate" type="date" defaultValue={c.ler_pagar_ate ?? ""} className={estiloCampo} />
                    </label>
                  </FormAcao>
                )}
                {editar && (
                  <FormAcao
                    acao={removerConta.bind(null, c.id)}
                    rotulo="Desligar"
                    enviando="..."
                    discreto
                    confirmar="Desligar o Tiny? O que já foi lido continua no sistema. Para tirar a autorização, apague também o aplicativo no Tiny."
                  />
                )}
              </div>
            )}
          </div>
        ))}

        {editar && (
          <div className="space-y-2">
            <p className="font-medium">1. Chaves do aplicativo</p>
            <p className="text-texto-suave">
              No Tiny: menu › Configurações › Geral › Aplicativos › Venner Gestão. Copie o Client ID e o Client Secret e cole aqui. Elas
              ficam guardadas no banco e nenhuma tela mostra de novo.
            </p>
            {aplicativos.map((a) => (
              <p key={a.empresa_id} className="text-xs text-texto-suave">
                {nomeEmpresa.get(a.empresa_id) ?? "—"}: chaves guardadas em {quando(a.atualizado_em)} (Client ID {a.client_id.slice(0, 18)}…)
              </p>
            ))}
            <FormAcao acao={salvarChavesTiny} rotulo="Guardar chaves" limpar className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Empresa dona da conta do Tiny">
                <select name="empresa" required defaultValue={empresas.length === 1 ? empresas[0].id : ""} className={estiloCampo}>
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
              <Campo rotulo="Client ID">
                <input name="client_id" required autoComplete="off" className={estiloCampo} />
              </Campo>
              <Campo rotulo="Client Secret">
                <input name="client_secret" type="password" required autoComplete="new-password" className={estiloCampo} />
              </Campo>
            </FormAcao>
          </div>
        )}

        {ligar && comChaves.length > 0 && (
          <div className="space-y-2">
            <p className="font-medium">2. Ligar a conta</p>
            <p className="text-texto-suave">Abre o Tiny para você autorizar com o seu login de lá. Depois volta para esta tela.</p>
            <form action="/integracoes/tiny/conectar" method="get" className="flex flex-wrap items-end gap-3">
              <Campo rotulo="Empresa" className="min-w-56 flex-1">
                <select name="empresa" required defaultValue={comChaves.length === 1 ? comChaves[0].id : ""} className={estiloCampo}>
                  <option value="" disabled>
                    Escolha...
                  </option>
                  {comChaves.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </Campo>
              <button type="submit" className={estiloBotao}>
                {contas.length ? "Ligar de novo" : "Ligar conta do Tiny"}
              </button>
            </form>
          </div>
        )}
      </div>
    </Cartao>
  );
}
