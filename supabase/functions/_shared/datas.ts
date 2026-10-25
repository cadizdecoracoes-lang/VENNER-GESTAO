// Datas no fuso de Brasília, como texto ISO (aaaa-mm-dd), para "hoje" e
// "vencido" baterem com o dia de quem usa. Sem dependências do Next.

export function hojeBrasil(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

export function somarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
}

// Segunda-feira da semana da data.
export function inicioSemana(iso: string): string {
  const dia = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return somarDias(iso, -((dia + 6) % 7));
}

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export function diaSemana(iso: string): string {
  return SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()];
}
