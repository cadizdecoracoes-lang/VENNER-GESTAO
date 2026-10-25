// Último uso do sistema, guardado no navegador e compartilhado entre as abas.
// Depois de LIMITE_SEM_USO sem uso, o login é encerrado (SaidaPorInatividade).
export const LIMITE_SEM_USO = 15 * 60_000;
const CHAVE = "venner_ultimo_uso";

export function ultimoUso(): number {
  try {
    return Number(localStorage.getItem(CHAVE)) || 0;
  } catch {
    return 0;
  }
}

// Também chamada ao entrar, para um uso antigo não derrubar o login novo.
export function marcarUso() {
  try {
    localStorage.setItem(CHAVE, String(Date.now()));
  } catch {
    // Sem armazenamento (janela anônima restrita): conta só nesta aba.
  }
}

export function esquecerUso() {
  try {
    localStorage.removeItem(CHAVE);
  } catch {
    // Idem.
  }
}
