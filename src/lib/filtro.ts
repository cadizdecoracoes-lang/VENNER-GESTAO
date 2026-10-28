// Regras do filtro das listas, sem tela (usadas por src/components/filtro.tsx
// e pelos testes): comparação sem acento, datas no formato brasileiro, tipo de
// cada coluna e as sugestões que aparecem a partir de duas letras.

import { somarDias } from "./datas.ts";

export const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// "27/10/2026" (ou "27/10/2026 14:30") → "2026-10-27"; outra coisa → null.
export function dataDaCelula(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?!\d)/.exec(texto.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export type TipoColuna = "texto" | "data" | "numero";

const VAZIO = new Set(["", "—", "-", "–"]);

// Valor, percentual ou número com casas ("R$ 1.234,56", "-12,5%", "3,000").
// Números inteiros soltos (código, nº do pedido) contam como texto, porque
// servem para achar o registro.
const NUMERO = /^[-−+]?\s*(R\$\s*)?[-−]?\s*[\d.]*\d(,\d+)?\s*%?$/;
function pareceNumero(v: string) {
  return NUMERO.test(v) && /R\$|,|%/.test(v);
}

// Coluna de data quando quase todas as células preenchidas são datas; de
// número quando são valores. As de texto viram sugestão e filtro por valor.
export function tipoDaColuna(valores: string[]): TipoColuna {
  const cheios = valores.map((v) => v.trim()).filter((v) => !VAZIO.has(v));
  if (cheios.length === 0) return "texto";
  const proporcao = (teste: (v: string) => boolean) => cheios.filter(teste).length / cheios.length;
  if (proporcao((v) => dataDaCelula(v) !== null) >= 0.8) return "data";
  if (proporcao(pareceNumero) >= 0.8) return "numero";
  return "texto";
}

export type ColunaFiltro = {
  rotulo: string;
  tipo: TipoColuna;
  // Valores distintos da coluna (como aparecem na tela) e quantas linhas têm cada um.
  valores: [string, number][];
};

// Lê as colunas a partir das células de cada linha (texto principal, sem os
// complementos pequenos). Colunas sem título (ações) ficam de fora.
export function montarColunas(rotulos: string[], linhas: string[][]): ColunaFiltro[] {
  return rotulos.flatMap((rotulo, i) => {
    if (!rotulo.trim()) return [];
    const celulas = linhas.map((l) => l[i] ?? "");
    const contagem = new Map<string, number>();
    for (const c of celulas) if (!VAZIO.has(c.trim())) contagem.set(c, (contagem.get(c) ?? 0) + 1);
    const valores = [...contagem].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true }));
    return [{ rotulo, tipo: tipoDaColuna(celulas), valores }];
  });
}

// Junta as colunas de várias tabelas com o mesmo título (ex.: uma por empresa).
export function juntarColunas(listas: ColunaFiltro[][]): ColunaFiltro[] {
  const porRotulo = new Map<string, { tipo: TipoColuna; valores: Map<string, number> }>();
  for (const colunas of listas) {
    for (const c of colunas) {
      const atual = porRotulo.get(c.rotulo) ?? { tipo: c.tipo, valores: new Map<string, number>() };
      if (atual.tipo !== c.tipo && c.valores.length > 0) atual.tipo = atual.valores.size === 0 ? c.tipo : "texto";
      for (const [v, n] of c.valores) atual.valores.set(v, (atual.valores.get(v) ?? 0) + n);
      porRotulo.set(c.rotulo, atual);
    }
  }
  return [...porRotulo].map(([rotulo, { tipo, valores }]) => ({
    rotulo,
    tipo,
    valores: [...valores].sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true })),
  }));
}

export type Sugestao = { coluna: string; valor: string; quantidade: number };

// O termo aparece no valor? Sem acento e, para CNPJ/CPF/telefone, também só
// pelos números ("12345678" acha "12.345.678/0001-90").
export function contem(valor: string, termo: string): boolean {
  const v = normalizar(valor);
  const t = normalizar(termo);
  if (v.includes(t)) return true;
  const digitos = t.replace(/\D/g, "");
  return /^[\d.\-/ ]+$/.test(t) && digitos !== "" && v.replace(/\D/g, "").includes(digitos);
}

// Cadastros que combinam com o que foi digitado, a partir de duas letras:
// primeiro os que começam com o termo, depois os que têm uma palavra que
// começa com ele, depois o resto; empates pelos mais usados na lista.
export function sugerir(colunas: ColunaFiltro[], termo: string, limite = 8): Sugestao[] {
  const t = normalizar(termo);
  if (t.length < 2) return [];
  const achadas: (Sugestao & { nota: number })[] = [];
  for (const c of colunas) {
    if (c.tipo !== "texto") continue;
    for (const [valor, quantidade] of c.valores) {
      if (!contem(valor, t)) continue;
      const v = normalizar(valor);
      const nota = v.startsWith(t) ? 0 : v.split(/[\s\-/.(]+/).some((p) => p.startsWith(t)) ? 1 : 2;
      achadas.push({ coluna: c.rotulo, valor, quantidade, nota });
    }
  }
  return achadas
    .sort((a, b) => a.nota - b.nota || b.quantidade - a.quantidade || a.valor.localeCompare(b.valor, "pt-BR"))
    .slice(0, limite)
    .map(({ coluna, valor, quantidade }) => ({ coluna, valor, quantidade }));
}

// Atalhos de período (as mesmas datas do FiltroPeriodo das telas financeiras).
export function intervaloDoMes(hoje: string, deslocamento: number): { de: string; ate: string } {
  const [a, m] = hoje.split("-").map(Number);
  const inicio = new Date(Date.UTC(a, m - 1 + deslocamento, 1));
  const fim = new Date(Date.UTC(a, m + deslocamento, 0));
  return { de: inicio.toISOString().slice(0, 10), ate: fim.toISOString().slice(0, 10) };
}

export function intervaloDeDias(hoje: string, quantidade: number): { de: string; ate: string } {
  const outro = somarDias(hoje, quantidade);
  return quantidade >= 0 ? { de: hoje, ate: outro } : { de: outro, ate: hoje };
}

// Data inteira num <input type="date">: ao digitar o ano o campo passa por
// 0002, 0020, 0202... e só vale de 1900 em diante.
export const dataCompleta = (v: string) => /^(19|2\d)\d{2}-\d{2}-\d{2}$/.test(v);
