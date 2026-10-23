// Parcelas de um pedido a partir da condição de pagamento escrita no pedido
// ("30/60/90", "28 e 56 dias", "à vista"). Sem dependências do Next.
import { somarDias } from "./datas.ts";

// Dias de cada parcela. Sem números na condição, usa o prazo de recebimento do pedido.
export function diasDaCondicao(condicao: string | null, prazoPadrao: number): number[] {
  const numeros =
    (condicao ?? "")
      .match(/\d+/g)
      ?.map(Number)
      .filter((n) => n <= 720) ?? [];
  if (numeros.length) return numeros;
  return [Math.max(0, prazoPadrao)];
}

// Divide o total em parcelas iguais; os centavos que sobram vão na última.
export function dividirParcelas(total: number, dias: number[], base: string): { valor: number; vencimento: string }[] {
  const cent = Math.round(total * 100);
  const parte = Math.floor(cent / dias.length);
  return dias.map((d, i) => ({
    valor: (i === dias.length - 1 ? cent - parte * (dias.length - 1) : parte) / 100,
    vencimento: somarDias(base, d),
  }));
}
