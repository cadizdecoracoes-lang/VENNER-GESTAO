import Link from "next/link";
import { Lock } from "lucide-react";
import { telaPorCodigo } from "@/lib/menu";

// Peças visuais comuns às telas de cadastro.

export const estiloCampo =
  "w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm outline-none focus:border-primaria disabled:bg-fundo disabled:text-texto-suave";

export const estiloBotao =
  "inline-flex items-center gap-1.5 rounded-lg bg-primaria px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60";

export const estiloBotaoSecundario =
  "inline-flex items-center gap-1.5 rounded-lg border border-borda bg-superficie px-3 py-2 text-sm text-texto hover:bg-fundo";

export function CabecalhoTela({ codigo, children }: { codigo: string; children?: React.ReactNode }) {
  const { tela, grupo } = telaPorCodigo(codigo);
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm text-texto-suave">{grupo}</p>
        <h1 className="text-2xl font-semibold">{tela.titulo}</h1>
        <p className="mt-1 text-texto-suave">{tela.descricao}</p>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Cartao({ titulo, children, acoes }: { titulo?: string; children: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-borda bg-superficie">
      {(titulo || acoes) && (
        <div className="flex items-center justify-between gap-2 border-b border-borda px-5 py-3">
          {titulo && <h2 className="font-medium">{titulo}</h2>}
          {acoes}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Campo({ rotulo, dica, children, className }: { rotulo: string; dica?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 text-sm ${className ?? ""}`}>
      <span className="text-texto-suave">{rotulo}</span>
      {children}
      {dica && <span className="block text-xs text-texto-suave">{dica}</span>}
    </label>
  );
}

const CORES = {
  neutra: "bg-fundo text-texto-suave",
  primaria: "bg-primaria-suave text-primaria",
  sucesso: "bg-sucesso/10 text-sucesso",
  alerta: "bg-alerta/10 text-alerta",
};

export function Etiqueta({ cor = "neutra", children }: { cor?: keyof typeof CORES; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CORES[cor]}`}>{children}</span>;
}

export function Tabela({ colunas, children, vazio }: { colunas: string[]; children: React.ReactNode; vazio?: string }) {
  const temLinhas = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="overflow-x-auto rounded-2xl border border-borda bg-superficie">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-borda text-left text-xs uppercase tracking-wide text-texto-suave">
            {colunas.map((c, i) => (
              <th key={i} className="px-4 py-2.5 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {temLinhas ? (
            children
          ) : (
            <tr>
              <td colSpan={colunas.length} className="px-4 py-8 text-center text-texto-suave">
                {vazio ?? "Nenhum cadastro ainda."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Celula({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 ${className ?? ""}`}>{children}</td>;
}

export function LinkAcao({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-primaria hover:underline">
      {children}
    </Link>
  );
}

export function SemAcesso({ codigo }: { codigo: string }) {
  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={codigo} />
      <div className="flex items-center gap-3 rounded-2xl border border-borda bg-superficie p-6 text-texto-suave">
        <Lock size={20} />
        <span>Seu perfil não tem acesso a esta tela. Fale com a diretoria se precisar dela.</span>
      </div>
    </div>
  );
}
