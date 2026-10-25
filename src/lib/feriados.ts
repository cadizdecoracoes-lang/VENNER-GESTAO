// Feriados nacionais (fixos + Carnaval, Sexta-feira Santa e Corpus Christi) e
// dia útil, para o fluxo de caixa levar vencimentos de fim de semana e feriado
// para o dia útil seguinte (quando o banco efetivamente paga ou recebe).
// Sem dependências do Next, para rodar também nos testes (node --test).
import { somarDias } from "./datas.ts";

const FIXOS: Record<string, string> = {
  "01-01": "Confraternização universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Consciência Negra",
  "12-25": "Natal",
};

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

const cache = new Map<number, Map<string, string>>();
function doAno(ano: number): Map<string, string> {
  let m = cache.get(ano);
  if (!m) {
    m = new Map(Object.entries(FIXOS).map(([k, v]) => [`${ano}-${k}`, v]));
    const p = pascoa(ano);
    m.set(somarDias(p, -48), "Carnaval");
    m.set(somarDias(p, -47), "Carnaval");
    m.set(somarDias(p, -2), "Sexta-feira Santa");
    m.set(somarDias(p, 60), "Corpus Christi");
    cache.set(ano, m);
  }
  return m;
}

export function feriado(iso: string): string | null {
  return doAno(Number(iso.slice(0, 4))).get(iso) ?? null;
}

export function fimDeSemana(iso: string): boolean {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

export function diaUtil(iso: string): boolean {
  return !fimDeSemana(iso) && !feriado(iso);
}

// O próprio dia, se útil; senão o próximo dia útil.
export function proximoDiaUtil(iso: string): string {
  let d = iso;
  while (!diaUtil(d)) d = somarDias(d, 1);
  return d;
}
