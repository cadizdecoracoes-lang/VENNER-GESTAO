// Último endereço (com os filtros ?de=&ate=...) de cada tela, enquanto o
// navegador está aberto. As abas e o menu voltam para ele, e a tela reabre
// do jeito que estava, em vez de voltar ao começo.

const PREFIXO = "venner.endereco:";
// Janelas abertas (pagar, editar...) não são lembradas.
const DE_JANELA = ["novo", "pagar", "editar", "ver", "lote", "volta"];

export function lembrarEndereco(caminho: string, busca: string) {
  try {
    const q = new URLSearchParams(busca);
    for (const k of DE_JANELA) q.delete(k);
    sessionStorage.setItem(PREFIXO + caminho, q.toString());
  } catch {
    // Sem armazenamento: a tela só abre do começo.
  }
}

export function ultimoEndereco(caminho: string): string {
  try {
    const busca = sessionStorage.getItem(PREFIXO + caminho);
    return busca ? `${caminho}?${busca}` : caminho;
  } catch {
    return caminho;
  }
}
