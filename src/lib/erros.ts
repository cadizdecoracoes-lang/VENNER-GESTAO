// Mensagens de erro do banco traduzidas para quem usa o sistema.

export type Estado = { erro?: string; ok?: number };

export const SEM_BANCO: Estado = { erro: "O banco de dados ainda não está conectado (modo de demonstração)." };
export const SEM_PERMISSAO = "Seu perfil não tem permissão para esta ação.";

export function mensagemErro(erro: { code?: string; message: string }): string {
  switch (erro.code) {
    case "23505":
      return "Já existe um cadastro com esse valor (código ou CNPJ repetido).";
    case "23503":
      return "Este cadastro está em uso em outro lugar e não pode ser removido.";
    case "23514":
      return "Algum valor está fora do permitido. Confira os números informados.";
    case "42501":
      return SEM_PERMISSAO;
    case "P0001":
      // Regras do próprio banco já escrevem a mensagem em português.
      return erro.message;
    default:
      return `Não foi possível salvar: ${erro.message}`;
  }
}

// Atualização barrada pela RLS não dá erro, só não altera nenhuma linha.
export function semLinhas(data: unknown[] | null): Estado | null {
  return data && data.length > 0 ? null : { erro: SEM_PERMISSAO };
}
