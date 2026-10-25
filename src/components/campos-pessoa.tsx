import { Campo, estiloCampo } from "./ui";
import { formatarDocumento } from "@/lib/formato";
import { TIPOS_PESSOA, UFS } from "@/lib/rotulos";
import type { DadosPessoa } from "@/lib/pessoa";

// Campos de cadastro de fornecedor ou cliente (os nomes batem com lerPessoa).
export function CamposPessoa({ valor }: { valor?: Partial<DadosPessoa> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Campo rotulo="Tipo">
        <select name="tipo_pessoa" defaultValue={valor?.tipo_pessoa ?? "juridica"} className={estiloCampo}>
          {Object.entries(TIPOS_PESSOA).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="CNPJ ou CPF" dica="Opcional, mas evita cadastro repetido.">
        <input name="documento" inputMode="numeric" defaultValue={valor?.documento ? formatarDocumento(valor.documento) : ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Razão social ou nome" className="sm:col-span-2">
        <input name="nome" required defaultValue={valor?.nome} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Nome fantasia" className="sm:col-span-2">
        <input name="nome_fantasia" defaultValue={valor?.nome_fantasia ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="E-mail">
        <input name="email" type="email" defaultValue={valor?.email ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Telefone">
        <input name="telefone" type="tel" defaultValue={valor?.telefone ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Cidade" className="sm:col-span-1 lg:col-span-3">
        <input name="cidade" defaultValue={valor?.cidade ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="UF">
        <select name="uf" defaultValue={valor?.uf ?? ""} className={estiloCampo}>
          <option value="">—</option>
          {UFS.map((uf) => (
            <option key={uf} value={uf}>
              {uf}
            </option>
          ))}
        </select>
      </Campo>
    </div>
  );
}
