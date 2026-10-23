import { Campo, estiloCampo } from "@/components/ui";
import type { EmpresaResumo } from "@/lib/empresa";

export type Funcionario = {
  id: string;
  empresa_id: string;
  matricula: string;
  nome: string;
  cpf: string | null;
  cargo: string | null;
  cbo: string | null;
  salario_base: number | null;
  admissao: string | null;
  desligamento: string | null;
  telefone: string | null;
  observacao: string | null;
  ativo: boolean;
};

export const CAMPOS_FUNCIONARIO =
  "id, empresa_id, matricula, nome, cpf, cargo, cbo, salario_base, admissao, desligamento, telefone, observacao, ativo";

// Campos do cadastro. Empresa e matrícula só na inclusão: o holerite liga por elas.
export function CamposFuncionario({ valor, empresas }: { valor?: Funcionario; empresas: EmpresaResumo[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {!valor && (
        <>
          <Campo rotulo="Empresa empregadora" className="sm:col-span-2">
            <select name="empresa_id" required defaultValue={empresas.length === 1 ? empresas[0].id : ""} className={estiloCampo}>
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
          <Campo rotulo="Matrícula" dica="O código do funcionário no holerite.">
            <input name="matricula" required className={estiloCampo} />
          </Campo>
          <div className="hidden lg:block" />
        </>
      )}
      <Campo rotulo="Nome completo" className="sm:col-span-2">
        <input name="nome" required defaultValue={valor?.nome ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="CPF">
        <input name="cpf" inputMode="numeric" defaultValue={valor?.cpf ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Telefone">
        <input name="telefone" defaultValue={valor?.telefone ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Cargo" className="sm:col-span-2">
        <input name="cargo" defaultValue={valor?.cargo ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="CBO">
        <input name="cbo" inputMode="numeric" defaultValue={valor?.cbo ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Salário base (R$)">
        <input
          name="salario_base"
          inputMode="decimal"
          defaultValue={valor?.salario_base != null ? String(valor.salario_base).replace(".", ",") : ""}
          className={estiloCampo}
        />
      </Campo>
      <Campo rotulo="Admissão">
        <input name="admissao" type="date" defaultValue={valor?.admissao ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Desligamento" dica="Preenchido, o funcionário fica inativo.">
        <input name="desligamento" type="date" defaultValue={valor?.desligamento ?? ""} className={estiloCampo} />
      </Campo>
      <Campo rotulo="Observação" className="sm:col-span-2">
        <input name="observacao" defaultValue={valor?.observacao ?? ""} className={estiloCampo} />
      </Campo>
      <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4">
        <input type="checkbox" name="ativo" defaultChecked={valor?.ativo ?? true} />
        Funcionário ativo
      </label>
    </div>
  );
}
