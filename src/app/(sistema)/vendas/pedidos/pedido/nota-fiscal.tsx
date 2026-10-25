"use client";

import { Download, FileText } from "lucide-react";
import { FormAcao } from "@/components/form-acao";
import { Campo, Cartao, Etiqueta, Fonte, estiloCampo } from "@/components/ui";
import { formatarData, formatarMoeda } from "@/lib/formato";
import { SITUACOES_NF, type SituacaoNF } from "@/lib/rotulos";
import { atualizarNotaFiscal, cancelarNotaFiscal, emitirNotaFiscal } from "../actions";

export type NotaVenda = {
  id: string;
  numero: string | null;
  serie: string | null;
  chave_acesso: string | null;
  situacao: SituacaoNF;
  mensagem: string | null;
  valor: number | null;
  emitida_em: string | null;
  link: string | null;
  contas_lancadas: boolean;
  justificativa_cancelamento: string | null;
  atualizada_em: string;
};

export type ArquivosNota = { danfe: string | null; xml: string | null; xmlCancelamento: string | null };

const COR: Record<SituacaoNF, "neutra" | "primaria" | "sucesso" | "alerta"> = {
  gerada: "neutra",
  enviada: "primaria",
  autorizada: "sucesso",
  rejeitada: "alerta",
  denegada: "alerta",
  cancelada: "neutra",
};

function Arquivo({ href, rotulo }: { href: string | null; rotulo: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primaria hover:underline">
      <Download size={14} /> {rotulo}
    </a>
  );
}

// Cartão da nota fiscal no pedido: emitir pelo Tiny, acompanhar a SEFAZ,
// baixar DANFE e XML e cancelar.
export function CartaoNotaFiscal({
  pedidoId,
  noTiny,
  notaDoTiny,
  nota,
  arquivos,
  podeEmitir,
}: {
  pedidoId: string;
  // O pedido foi lido do Tiny (os lançados aqui ainda não vão ao Tiny).
  noTiny: boolean;
  // Número da nota que a leitura do Tiny trouxe (emitida direto lá).
  notaDoTiny: string | null;
  nota: NotaVenda | null;
  arquivos: ArquivosNota;
  podeEmitir: boolean;
}) {
  const valendo = nota && nota.situacao !== "cancelada" && nota.situacao !== "denegada" ? nota : null;

  return (
    <Cartao titulo="Nota fiscal" acoes={nota ? <Etiqueta cor={COR[nota.situacao]}>{SITUACOES_NF[nota.situacao]}</Etiqueta> : null}>
      <div className="space-y-4 text-sm">
        {nota && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 font-medium">
              <FileText size={16} className="text-texto-suave" />
              {nota.numero ? `NF-e nº ${nota.numero}${nota.serie ? ` · série ${nota.serie}` : ""}` : "NF-e ainda sem número"}
            </p>
            {(nota.emitida_em || nota.valor) && (
              <p className="text-texto-suave">
                {nota.emitida_em && `Emitida em ${formatarData(nota.emitida_em)}`}
                {nota.emitida_em && nota.valor ? " · " : ""}
                {nota.valor ? formatarMoeda(Number(nota.valor)) : ""}
              </p>
            )}
            {nota.mensagem && <p className="rounded-lg bg-alerta/10 px-3 py-2 text-alerta">{nota.mensagem}</p>}
            {nota.situacao === "cancelada" && nota.justificativa_cancelamento && (
              <p className="text-texto-suave">Cancelada: {nota.justificativa_cancelamento}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Arquivo href={arquivos.danfe} rotulo="DANFE (PDF)" />
              <Arquivo href={arquivos.xml} rotulo="XML" />
              <Arquivo href={arquivos.xmlCancelamento} rotulo="XML do cancelamento" />
              <Arquivo href={nota.link} rotulo="Consultar na SEFAZ" />
            </div>
            {nota.situacao === "autorizada" && (
              <Fonte>
                {nota.contas_lancadas
                  ? "Contas a receber lançadas no Tiny; aparecem aqui na próxima leitura (a cada 5 minutos)."
                  : "As contas a receber ainda não foram lançadas no Tiny. Clique em Atualizar."}
              </Fonte>
            )}
          </div>
        )}

        {!noTiny ? (
          <p className="text-texto-suave">Pedido lançado aqui: o envio do pedido ao Tiny para faturar vem num próximo pacote.</p>
        ) : !podeEmitir ? (
          !nota && (
            <p className="text-texto-suave">
              {notaDoTiny ? `Nota nº ${notaDoTiny} emitida no Tiny.` : "Sem nota fiscal."} Emitir e cancelar nota exige a permissão Aprovar em
              Pedidos de venda.
            </p>
          )
        ) : (
          <div className="space-y-3">
            {(!valendo || valendo.situacao === "gerada" || valendo.situacao === "rejeitada") && !(notaDoTiny && !nota) && (
              <FormAcao
                acao={emitirNotaFiscal.bind(null, pedidoId)}
                rotulo={valendo ? "Tentar emitir de novo" : "Emitir NF"}
                enviando="Emitindo no Tiny..."
                confirmar={
                  valendo
                    ? "Mandar a nota de novo para a SEFAZ? Corrija antes no Tiny o que a rejeição apontou."
                    : "Emitir a nota fiscal deste pedido pelo Tiny? A nota vai para a SEFAZ com os dados do pedido no Tiny."
                }
                className="space-y-3"
              >
                <label className="flex items-center gap-2 text-texto-suave">
                  <input type="checkbox" name="enviar_email" /> Enviar a nota por e-mail ao cliente
                </label>
              </FormAcao>
            )}
            {(valendo || notaDoTiny) && (
              <FormAcao
                acao={atualizarNotaFiscal.bind(null, pedidoId)}
                rotulo={nota ? "Atualizar" : `Trazer a nota nº ${notaDoTiny} do Tiny`}
                enviando="Consultando o Tiny..."
                secundario
              />
            )}
            {valendo?.situacao === "autorizada" && (
              <details className="rounded-lg border border-borda px-3 py-2">
                <summary className="cursor-pointer text-texto-suave">Cancelar a nota</summary>
                <FormAcao
                  acao={cancelarNotaFiscal.bind(null, pedidoId)}
                  rotulo="Cancelar na SEFAZ"
                  enviando="Cancelando..."
                  secundario
                  confirmar="Cancelar esta nota na SEFAZ? As contas a receber e o estoque lançados por ela são estornados no Tiny. Não dá para desfazer."
                  className="mt-3 space-y-3"
                >
                  <Campo rotulo="Motivo" dica="De 15 a 255 letras. Vai para a SEFAZ. Normalmente a SEFAZ aceita até 24 horas depois da autorização.">
                    <textarea name="justificativa" rows={2} minLength={15} maxLength={255} required className={estiloCampo} />
                  </Campo>
                </FormAcao>
              </details>
            )}
          </div>
        )}
        {noTiny && !nota && podeEmitir && !notaDoTiny && (
          <Fonte>
            O Tiny gera a nota com os dados do pedido de lá (cliente, produtos, natureza de operação) e manda para a SEFAZ. Autorizada, o
            DANFE e o XML ficam guardados aqui e o Tiny lança as contas a receber.
          </Fonte>
        )}
      </div>
    </Cartao>
  );
}
