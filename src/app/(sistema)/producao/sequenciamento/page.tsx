"use client";

import { CabecalhoTela, Celula, Etiqueta, Fonte, Indicador, LinkAcao, SemAcesso, Tabela } from "@/components/ui";
import { Filtro } from "@/components/filtro";
import { carregarAcesso, pode } from "@/lib/acesso";
import { hojeBrasil } from "@/lib/datas";
import { carregarEmpresas } from "@/lib/empresa";
import { formatarData, formatarMoeda, formatarNumero } from "@/lib/formato";
import { filaProducao } from "@/lib/planejamento";
import { carregarPlanejamento } from "@/lib/planejamento-servidor";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "producao.sequenciamento";

async function PaginaSequenciamento() {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;
  const hoje = hojeBrasil();
  const [dados, empresas] = await Promise.all([carregarPlanejamento(), carregarEmpresas()]);
  const fila = dados ? filaProducao(dados, hoje) : [];
  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));

  const prontos = fila.filter((f) => f.pode_produzir);
  const bloqueados = fila.filter((f) => !f.pode_produzir);
  const atrasados = fila.filter((f) => f.dias_atraso > 0);
  const soma = (l: typeof fila) => l.reduce((s, f) => s + f.valor, 0);
  const horas = prontos.reduce((s, f) => s + f.horas, 0);

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA} />
      {!dados ? (
        <p className="text-texto-suave">Não foi possível ler o planejamento.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Indicador
              rotulo="Podem ser produzidos já"
              valor={prontos.length}
              detalhe={`${formatarMoeda(soma(prontos))} · ${formatarNumero(Math.round(horas * 10) / 10)} h`}
              cor="text-sucesso"
              fonte="Material completo em estoque, reservado na ordem da fila (quem está acima usa primeiro)."
            />
            <Indicador
              rotulo="Parados por falta de material"
              valor={bloqueados.length}
              detalhe={formatarMoeda(soma(bloqueados))}
              cor={bloqueados.length ? "text-alerta" : ""}
              href="/compras/sugestoes"
              fonte="Falta matéria-prima ou o produto não tem ficha técnica ativa. Veja o que comprar."
            />
            <Indicador
              rotulo="Em atraso"
              valor={atrasados.length}
              detalhe={formatarMoeda(soma(atrasados))}
              cor={atrasados.length ? "text-perigo" : ""}
              fonte={`Prazo de entrega antes de ${formatarData(hoje)}.`}
            />
            <Indicador
              rotulo="Pedidos na fila"
              valor={fila.length}
              detalhe={formatarMoeda(soma(fila))}
              href="/vendas/pedidos"
              fonte="Pedidos de venda em etapas da fase Produção, de todas as empresas."
            />
          </div>

          <Filtro
            atalhos={[
              {
                rotulo: "Situação",
                opcoes: [
                  { valor: "pronto", rotulo: "Pode produzir" },
                  { valor: "parado", rotulo: "Falta material" },
                  { valor: "atrasado", rotulo: "Atrasados" },
                ],
              },
            ]}
            placeholder="Filtrar por pedido, cliente, item em falta..."
          >
            <Tabela
              colunas={["#", "Pedido", "Cliente", "Prazo", "Valor", "Horas", "Previsão", "Por que nesta posição"]}
              vazio="Nenhum pedido em produção."
            >
              {fila.map((f, k) => (
                <tr
                  key={f.pedido.id}
                  data-tags={[f.pode_produzir ? "pronto" : "parado", f.dias_atraso > 0 && "atrasado"].filter(Boolean).join(" ")}
                  className={f.pode_produzir ? "" : "bg-alerta/5"}
                >
                  <Celula className="tabular-nums text-texto-suave">{k + 1}</Celula>
                  <Celula className="whitespace-nowrap">
                    <LinkAcao href={`/vendas/pedidos/pedido?id=${f.pedido.id}`}>Nº {f.pedido.numero}</LinkAcao>
                    <span className="block text-xs text-texto-suave">{f.pedido.etapa}</span>
                  </Celula>
                  <Celula>
                    <span className="font-medium">{f.pedido.cliente}</span>
                    <span className="block text-xs text-texto-suave">{nomeEmpresa.get(f.pedido.empresa_id) ?? ""}</span>
                  </Celula>
                  <Celula className={`whitespace-nowrap tabular-nums ${f.dias_atraso > 0 ? "font-medium text-perigo" : ""}`}>
                    {formatarData(f.pedido.prazo_entrega)}
                    {f.dias_atraso > 0 && <span className="block text-xs">{f.dias_atraso} dias de atraso</span>}
                  </Celula>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarMoeda(f.valor)}</Celula>
                  <Celula className="whitespace-nowrap tabular-nums">{formatarNumero(f.horas)} h</Celula>
                  <Celula className="whitespace-nowrap">
                    {f.pode_produzir ? (
                      <>
                        <Etiqueta cor="sucesso">{f.atendido_estoque ? "Já em estoque" : "Pode produzir"}</Etiqueta>
                        <span className="block text-xs tabular-nums text-texto-suave">
                          {f.atendido_estoque ? "pronto para separar" : `termina até ${formatarData(f.previsao)}`}
                        </span>
                      </>
                    ) : (
                      <Etiqueta cor="alerta">Falta material</Etiqueta>
                    )}
                  </Celula>
                  <Celula className="text-xs text-texto-suave">
                    <ul className="space-y-0.5">
                      {f.motivos.map((m, i) => (
                        <li key={i} className={m.startsWith("Falta ") || m.includes("sem ficha") ? "text-perigo" : ""}>
                          {m}
                        </li>
                      ))}
                    </ul>
                    <span className="mt-1 block tabular-nums">{formatarNumero(f.pontos)} pontos</span>
                  </Celula>
                </tr>
              ))}
            </Tabela>
          </Filtro>
          <Fonte>
            Como a fila é montada: primeiro os pedidos que têm todo o material em estoque, depois os parados. Dentro de cada grupo, a ordem
            segue os pontos: dias de atraso (até 90, e até −30 para quem ainda tem folga) + até 20 pelo valor por hora de fábrica + até 10
            pela rapidez do recebimento + 50 por nível de prioridade (alta 50, urgente 100). As horas vêm do roteiro da ficha técnica
            (preparação + execução × quantidade, em todos os níveis); a previsão soma a carga de cada posto pela capacidade diária, na ordem
            da fila. O estoque é reservado de cima para baixo, e quem está parado não segura material de ninguém.
          </Fonte>
        </>
      )}
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaSequenciamento} />;
}
