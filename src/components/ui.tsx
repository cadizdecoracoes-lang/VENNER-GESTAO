import Link from "next/link";
import { Building2, Info, Lock } from "lucide-react";
import { telaPorCodigo } from "@/lib/menu";

// Peças visuais comuns às telas. Regra de layout (vale para toda tela nova):
// o cabeçalho é uma linha discreta e o destaque fica nos lançamentos. Nada de
// subtítulo, faixas coloridas ou cartões altos acima da lista; explicações vão
// na dica (passar o mouse) e os números resumidos numa faixa fina.

export const estiloCampo =
  "w-full rounded-lg border border-borda bg-superficie px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-primaria disabled:bg-fundo disabled:text-texto-suave";

export const estiloBotao =
  "inline-flex items-center gap-1.5 rounded-lg bg-primaria px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60";

export const estiloBotaoSecundario =
  "inline-flex items-center gap-1.5 rounded-lg bg-superficie px-3 py-1.5 text-sm text-texto shadow-[0_0_0_1px_var(--color-borda)] hover:bg-fundo";

// Uma linha só: módulo, título e (nas telas por CNPJ) a empresa em uso. A
// descrição da tela aparece ao passar o mouse no título. `empresa`: passe a
// empresa escolhida no topo (null = consolidado) nas telas separadas por CNPJ.
// `ajuda`: explicação longa da tela, aberta pelo ícone (i) em vez de ocupar espaço.
export function CabecalhoTela({
  codigo,
  empresa,
  ajuda,
  children,
}: {
  codigo: string;
  empresa?: { nome: string } | null;
  ajuda?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { tela, grupo } = telaPorCodigo(codigo);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-xs text-texto-suave">{grupo} /</span>
        <h1 className="text-lg font-semibold leading-tight" title={tela.descricao}>
          {tela.titulo}
        </h1>
        {ajuda && (
          <details className="relative self-center">
            <summary className="flex cursor-pointer list-none items-center rounded p-0.5 text-texto-suave hover:text-primaria [&::-webkit-details-marker]:hidden">
              <Info size={15} aria-label="Como funciona esta tela" />
            </summary>
            <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-xl bg-superficie p-3 text-xs leading-relaxed text-texto-suave shadow-[0_4px_16px_rgba(16,24,40,0.14)]">
              {ajuda}
            </div>
          </details>
        )}
        {empresa !== undefined && <FaixaEmpresa empresa={empresa} />}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Cartao({ titulo, children, acoes }: { titulo?: string; children: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-superficie shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      {(titulo || acoes) && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          {titulo && <h2 className="text-sm font-semibold">{titulo}</h2>}
          {acoes}
        </div>
      )}
      <div className="p-4">{children}</div>
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
    <div className={`overflow-x-auto ${embutida ? "-mx-1" : "rounded-xl bg-superficie shadow-[0_1px_3px_rgba(16,24,40,0.06)]"}`}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-texto-suave">
            {colunas.map((c, i) => (
              <th key={i} className="whitespace-nowrap border-b border-borda/70 px-3 py-2 font-medium">
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
              <td colSpan={colunas.length} className="px-3 py-6 text-center text-texto-suave">
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
  return <td className={`px-3 py-1.5 ${className ?? ""}`}>{children}</td>;
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
    <div className="space-y-3">
      <CabecalhoTela codigo={codigo} />
      <div className="flex items-center gap-3 rounded-xl bg-superficie p-4 text-texto-suave shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
        <Lock size={20} />
        <span>Seu perfil não tem acesso a esta tela. Fale com a diretoria se precisar dela.</span>
      </div>
    </div>
  );
}

// Diz de qual CNPJ são os dados da tela, conforme o seletor "Empresa" do topo.
// Etiqueta pequena ao lado do título; a explicação fica na dica.
export function FaixaEmpresa({ empresa }: { empresa: { nome: string } | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 self-center rounded-full bg-primaria-suave px-2 py-0.5 text-xs text-primaria"
      title={
        empresa
          ? 'Mostrando só esta empresa. Para ver todas, escolha "Grupo (consolidado)" no topo.'
          : "Todas as empresas, separadas por CNPJ. Para ver uma empresa só, escolha o CNPJ no topo."
      }
    >
      <Building2 size={12} />
      {empresa ? empresa.nome : "Grupo (consolidado)"}
    </span>
  );
}

// De onde vem um número: a origem dos dados e o período usado. Todo valor
// resumido das telas leva essa linha, e o próprio número abre os registros.
export function Fonte({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-texto-suave">{children}</p>;
}

// Número resumido que abre a lista dos registros que o formam. Compacto: a
// origem do número (fonte) fica na dica do ícone (i), para não ocupar a tela.
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
  const dica = typeof fonte === "string" ? fonte : undefined;
  const corpo = (
    <>
      <p className="flex items-center gap-1 truncate text-xs text-texto-suave" title={dica}>
        {rotulo}
        {fonte && <Info size={12} className="shrink-0 opacity-60" aria-label={dica} />}
      </p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className={`text-base font-semibold tabular-nums ${cor ?? ""}`}>{valor}</span>
        {detalhe && <span className="text-xs text-texto-suave">{detalhe}</span>}
      </p>
      {fonte && !dica && <div className="mt-1 text-[11px] leading-snug text-texto-suave">{fonte}</div>}
    </>
  );
  const estilo = "block min-w-0 rounded-xl bg-superficie px-3 py-2 shadow-[0_1px_3px_rgba(16,24,40,0.06)]";
  return href ? (
    <Link href={href} className={`${estilo} transition-shadow hover:shadow-[0_0_0_1.5px_var(--color-primaria)]`}>
      {corpo}
    </Link>
  ) : (
    <div className={estilo} title={dica}>
      {corpo}
    </div>
  );
}
