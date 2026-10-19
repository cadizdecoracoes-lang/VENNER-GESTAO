// Campos comuns a fornecedores e clientes, lidos e validados do formulário.
import { cnpjValido, cpfValido, somenteDigitos } from "./formato";
import { TIPOS_PESSOA, UFS, type TipoPessoa } from "./rotulos";

export type DadosPessoa = {
  tipo_pessoa: TipoPessoa;
  documento: string | null;
  nome: string;
  nome_fantasia: string | null;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  uf: string | null;
  observacao: string | null;
  ativo: boolean;
};

const texto = (form: FormData, campo: string) => String(form.get(campo) ?? "").trim() || null;

export function lerPessoa(form: FormData): { dados: DadosPessoa } | { erro: string } {
  const tipo = String(form.get("tipo_pessoa") ?? "juridica");
  if (!(tipo in TIPOS_PESSOA)) return { erro: "Escolha pessoa jurídica ou física." };
  const tipoPessoa = tipo as TipoPessoa;

  const documento = somenteDigitos(form.get("documento")) || null;
  if (documento && tipoPessoa === "juridica" && !cnpjValido(documento)) return { erro: "CNPJ inválido. Confira os números." };
  if (documento && tipoPessoa === "fisica" && !cpfValido(documento)) return { erro: "CPF inválido. Confira os números." };

  const nome = texto(form, "nome");
  if (!nome) return { erro: tipoPessoa === "juridica" ? "Informe a razão social." : "Informe o nome." };

  const uf = texto(form, "uf")?.toUpperCase() ?? null;
  if (uf && !(UFS as readonly string[]).includes(uf)) return { erro: "UF inválida." };

  return {
    dados: {
      tipo_pessoa: tipoPessoa,
      documento,
      nome,
      nome_fantasia: texto(form, "nome_fantasia"),
      email: texto(form, "email"),
      telefone: texto(form, "telefone"),
      cidade: texto(form, "cidade"),
      uf,
      observacao: texto(form, "observacao"),
      ativo: form.get("ativo") === "on",
    },
  };
}
