import Link from "next/link";
import { Lock } from "lucide-react";
import { telaPorCodigo } from "@/lib/menu";

// Peças visuais comuns às telas de cadastro.

export const estiloCampo =
  "w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm outline-none transition-colors focus:border-primaria disabled:bg-fundo disabled:text-texto-suave";

export const estiloBotao =
  "inline-flex items-center gap-1.5 rounded-lg bg-primaria px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60";

export const estiloBotaoSecundario =
  "inline-flex items-center gap-1.5 rounded-lg bg-superficie px-3 py-2 text-sm text-texto shadow-[0_0_0_1px_var(--color-borda)] hover:bg-fundo";

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
    <section className="rounded-2xl bg-superficie shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      {(titulo || acoes) && (
        <div className="flex items-center justify-between gap-2 px-5 pt-4">
          {titulo && <h2 className="font-medium">{titulo}</h2>}
          {acoes}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Campo({
  rotulo,
  dica,
  children,
  className,
}: {
  rotulo: string;
  dica?: string;
  children: React.ReactNode;
  className?: string;
}) {
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
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${CORES[cor]}`}>{children}</span>;
}

// `embutida`: dentro de um Cartão, sem fundo e sombra próprios.
export function Tabela({
  colunas,
  children,
  vazio,
  embutida = false,
}: {
  colunas: string[];
  children: React.ReactNode;
  vazio?: string;
  embutida?: boolean;
}) {
  const temLinhas = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className={`overflow-x-auto ${embutida ? "-mx-1" : "rounded-2xl bg-superficie shadow-[0_1px_3px_rgba(16,24,40,0.06)]"}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-texto-suave">
            {colunas.map((c, i) => (
              <th key={i} className="px-4 pb-2 pt-3 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borda/70 [&>tr:not([data-vazio])]:transition-colors [&>tr:not([data-vazio]):hover]:bg-fundo/70">
          {temLinhas ? (
            children
          ) : (
            <tr data-vazio>
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
  return <td className={`px-4 py-3 ${className ?? ""}`}>{children}</td>;
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
      <div className="flex items-center gap-3 rounded-2xl bg-superficie p-6 text-texto-suave shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <Lock size={20} />
        <span>Seu perfil não tem acesso a esta tela. Fale com a diretoria se precisar dela.</span>
      </div>
    </div>
  );
}

// Diz de qual CNPJ são os dados da tela, conforme o seletor "Empresa" do topo.
export function FaixaEmpresa({ empresa }: { empresa: { nome: string } | null }) {
  return (
    <p className="rounded-xl bg-primaria-suave px-4 py-2.5 text-sm text-primaria">
      {empresa ? (
        <>
          Mostrando só <strong>{empresa.nome}</strong>. Para ver todas as empresas, escolha &quot;Grupo (consolidado)&quot; no topo.
        </>
      ) : (
        <>
          <strong>Consolidado do grupo</strong>, separado por empresa. Para ver uma empresa só, escolha o CNPJ no topo.
        </>
      )}
    </p>
  );
}

// De onde vem um número: a origem dos dados e o período usado. Todo valor
// resumido das telas leva essa linha, e o próprio número abre os registros.
export function Fonte({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-texto-suave">{children}</p>;
}

// Número resumido que abre a lista dos registros que o formam.
export function Indicador({
  rotulo,
  valor,
  detalhe,
  href,
  cor,
  fonte,
}: {
  rotulo: string;
  valor: React.ReactNode;
  detalhe?: React.ReactNode;
  href?: string;
  cor?: string;
  fonte?: React.ReactNode;
}) {
  const corpo = (
    <>
      <p className="text-sm text-texto-suave">{rotulo}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${cor ?? ""}`}>{valor}</p>
      {detalhe && <p className="text-xs text-texto-suave">{detalhe}</p>}
      {fonte && <p className="mt-2 border-t border-borda/70 pt-2 text-[11px] leading-snug text-texto-suave">{fonte}</p>}
    </>
  );
  const estilo = "block rounded-2xl bg-superficie px-5 py-4 shadow-[0_1px_3px_rgba(16,24,40,0.06)]";
  return href ? (
    <Link href={href} className={`${estilo} transition-shadow hover:shadow-[0_0_0_1.5px_var(--color-primaria)]`}>
      {corpo}
    </Link>
  ) : (
    <div className={estilo}>{corpo}</div>
  );
}
