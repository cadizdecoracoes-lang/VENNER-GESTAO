import { Search } from "lucide-react";

// Cartões do painel. Os valores entram quando os módulos estiverem ligados ao
// banco; a lupa de cada cartão vai abrir a origem do número.
const CARTOES = [
  { titulo: "Ordens atrasadas", origem: "Ordens de produção com prazo vencido" },
  { titulo: "Falta de material", origem: "Necessidades do MRP sem estoque nem compra a caminho" },
  { titulo: "Saldo em caixa", origem: "Saldos bancários conciliados, por CNPJ" },
  { titulo: "Contas a pagar na semana", origem: "Títulos a pagar dos próximos 7 dias" },
];

export default function Painel() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Painel</h1>
        <p className="mt-1 text-texto-suave">Visão geral do dia: produção, estoque, caixa e pendências.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {CARTOES.map((c) => (
          <div key={c.titulo} className="rounded-2xl border border-borda bg-superficie p-5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm text-texto-suave">{c.titulo}</span>
              <button
                className="rounded-lg p-1 text-texto-suave hover:bg-fundo"
                title={`Origem: ${c.origem}`}
                aria-label={`Ver origem de ${c.titulo}`}
              >
                <Search size={16} />
              </button>
            </div>
            <div className="mt-3 text-2xl font-semibold text-texto-suave">—</div>
          </div>
        ))}
      </div>
    </div>
  );
}
