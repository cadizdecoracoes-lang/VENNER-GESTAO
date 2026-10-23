// Leitura dos recibos de pagamento (holerites) em PDF gerados pelo sistema de
// folha da contabilidade: cada página traz o recibo em duas vias, com o
// empregador, o funcionário, os eventos e as bases do mês. A leitura usa a
// posição de cada texto na página (colunas de vencimentos e descontos).

export type Peca = { x: number; y: number; s: string };

export type EventoLido = {
  codigo: string;
  descricao: string;
  referencia: number | null;
  valor: number;
  natureza: "provento" | "desconto";
};

export type HoleriteLido = {
  empregador_nome: string;
  empregador_cnpj: string;
  tipo: string;
  competencia: string; // "2026-01"
  matricula: string;
  nome: string;
  cbo: string | null;
  cargo: string | null;
  eventos: EventoLido[];
  total_proventos: number;
  total_descontos: number;
  liquido: number;
  salario_base: number;
  base_inss: number;
  base_fgts: number;
  fgts: number;
  base_irrf: number;
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const TIPOS: Record<string, string> = {
  MENSAL: "mensal",
  ADTO: "adiantamento",
  ADIANTAMENTO: "adiantamento",
  FERIAS: "ferias",
  FÉRIAS: "ferias",
  "13": "decimo_terceiro",
  "13º": "decimo_terceiro",
  RESCISAO: "rescisao",
  RESCISÃO: "rescisao",
};

export const ROTULO_TIPO_HOLERITE: Record<string, string> = {
  mensal: "Mensal",
  adiantamento: "Adiantamento (vale)",
  ferias: "Férias",
  decimo_terceiro: "13º salário",
  rescisao: "Rescisão",
};

// "2026-01-01" ou "2026-01" → "01/2026".
export const mesAno = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;

// "1.980,87" → 1980.87; "*****" e vazio → 0.
export function valorBr(t: string): number {
  if (!/^-?[\d.]*,\d+$/.test(t.trim())) return 0;
  return Number(t.trim().replace(/\./g, "").replace(",", "."));
}
const ehValor = (t: string) => /^-?[\d.]*\d,\d{2}$/.test(t.trim());
const arred2 = (v: number) => Math.round(v * 100) / 100;
const PERTO = 3;

function rotulo(pecas: Peca[], texto: string): Peca | undefined {
  return pecas.find((p) => p.s.trim() === texto);
}
function naLinha(pecas: Peca[], y: number): Peca[] {
  return pecas.filter((p) => Math.abs(p.y - y) <= PERTO).sort((a, b) => a.x - b.x);
}
// Primeira linha abaixo de um rótulo (os valores ficam logo embaixo do título da coluna).
function linhaAbaixo(pecas: Peca[], y: number, limite = 16): Peca[] {
  const abaixo = pecas.filter((p) => p.y < y - 1 && p.y >= y - limite);
  if (!abaixo.length) return [];
  const topo = Math.max(...abaixo.map((p) => p.y));
  return naLinha(abaixo, topo);
}
function maisPerto<T extends { x: number }>(x: number, opcoes: T[]): T {
  return opcoes.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
}

// Um recibo: as peças entre o título "RECIBO DE PAGAMENTO" e o próximo.
function lerRecibo(pecas: Peca[], topo: number): HoleriteLido {
  const cabecalho = naLinha(pecas, topo).filter((p) => p.s.trim() !== "RECIBO DE PAGAMENTO");
  const cnpj = pecas.find((p) => /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(p.s.trim()));
  const mes = pecas.find((p) => /^[A-Za-zçÇ]+\/\d{4}$/.test(p.s.trim()));
  if (!cnpj || !mes) throw new Error("recibo sem CNPJ do empregador ou sem o mês");
  const [nomeMes, ano] = mes.s.trim().split("/");
  const numMes = MESES.indexOf(nomeMes.toLowerCase()) + 1;
  if (!numMes) throw new Error(`mês "${mes.s}" não reconhecido`);
  const tipoBruto = pecas
    .filter((p) => p.y < topo - 1 && p.y > mes.y + 1 && p.x > 380)
    .map((p) => p.s.trim().toUpperCase())
    .find((s) => s);
  if (!tipoBruto) throw new Error("recibo sem o tipo (mensal, adiantamento...)");

  const titNome = rotulo(pecas, "Nome");
  const titCbo = rotulo(pecas, "Cbo");
  if (!titNome) throw new Error("recibo sem a linha do funcionário");
  const func = linhaAbaixo(pecas, titNome.y);
  const matricula = func.find((p) => p.x < titNome.x - 2 && /^\d+$/.test(p.s.trim()));
  const nome = func.find((p) => Math.abs(p.x - titNome.x) <= 6);
  if (!matricula || !nome) throw new Error("recibo sem matrícula ou nome do funcionário");
  const cbo = titCbo ? func.find((p) => Math.abs(p.x - titCbo.x) <= 12 && /^\d{6}$/.test(p.s.trim())) : undefined;
  const cargo = linhaAbaixo(pecas, nome.y, 14).find((p) => Math.abs(p.x - nome.x) <= 6);

  const titDesc = rotulo(pecas, "Descrição");
  const titRef = rotulo(pecas, "Referência");
  const titVenc = rotulo(pecas, "Vencimentos");
  const titDescontos = rotulo(pecas, "Descontos");
  const totVenc = rotulo(pecas, "Total Vencimentos");
  const totDesc = rotulo(pecas, "Total Descontos");
  const totLiq = pecas.find((p) => p.s.trim().startsWith("Total Liquido") || p.s.trim().startsWith("Total Líquido"));
  if (!titDesc || !titVenc || !titDescontos || !totVenc || !totDesc || !totLiq) throw new Error("recibo sem a tabela de eventos");

  // Eventos: linhas entre o título da tabela e os totais.
  const corpo = pecas.filter((p) => p.y < titDesc.y - 1 && p.y > totVenc.y + 1);
  const ys = [...new Set(corpo.map((p) => Math.round(p.y)))].sort((a, b) => b - a);
  const usadas = new Set<number>();
  const eventos: EventoLido[] = [];
  for (const y of ys) {
    if (usadas.has(y)) continue;
    const linha = naLinha(corpo, y);
    for (const p of linha) usadas.add(Math.round(p.y));
    const codigo = linha.find((p) => p.x < titDesc.x - 2 && /^\d+$/.test(p.s.trim()));
    const descricao = linha.find((p) => p.x >= titDesc.x - 4 && p.x < (titRef?.x ?? titVenc.x) - 10 && !ehValor(p.s));
    const valores = linha.filter((p) => ehValor(p.s));
    if (!codigo || !descricao || !valores.length) continue;
    const limiteRef = titVenc.x - 60;
    const ref = valores.find((p) => p.x < limiteRef);
    const valor = valores.filter((p) => p.x >= limiteRef).pop();
    if (!valor) continue;
    const coluna = maisPerto(valor.x, [
      { x: titVenc.x + 25, n: "provento" as const },
      { x: titDescontos.x + 25, n: "desconto" as const },
    ]);
    eventos.push({
      codigo: codigo.s.trim(),
      descricao: descricao.s.trim(),
      referencia: ref ? valorBr(ref.s) : null,
      valor: valorBr(valor.s),
      natureza: coluna.n,
    });
  }

  const totais = linhaAbaixo(pecas, totVenc.y);
  const total = (alvo: Peca) => {
    const p = totais.length ? maisPerto(alvo.x + 25, totais) : undefined;
    return p && Math.abs(p.x - (alvo.x + 25)) < 45 ? valorBr(p.s) : 0;
  };
  const liquido = pecas.filter((p) => Math.abs(p.y - totLiq.y) <= PERTO && p.x > totLiq.x + 20).pop();

  const titBases = ["Salario Base", "Sal.Contr.INSS", "Base Calculo FGTS", "FGTS do MES", "Base Calculo IRRF"].map((t) => rotulo(pecas, t));
  const linhaBases = titBases[0] ? linhaAbaixo(pecas, titBases[0].y) : [];
  const base = (i: number) => {
    const t = titBases[i];
    if (!t || !linhaBases.length) return 0;
    const p = maisPerto(t.x + 10, linhaBases);
    return Math.abs(p.x - (t.x + 10)) < 40 ? valorBr(p.s) : 0;
  };

  return {
    empregador_nome: cabecalho.map((p) => p.s.trim()).join(" ").trim(),
    empregador_cnpj: cnpj.s.replace(/\D/g, ""),
    tipo: TIPOS[tipoBruto] ?? tipoBruto.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_"),
    competencia: `${ano}-${String(numMes).padStart(2, "0")}`,
    matricula: matricula.s.trim(),
    nome: nome.s.trim().replace(/\s+/g, " "),
    cbo: cbo?.s.trim() ?? null,
    cargo: cargo?.s.trim() || null,
    eventos,
    total_proventos: total(totVenc),
    total_descontos: total(totDesc),
    liquido: liquido ? valorBr(liquido.s) : 0,
    salario_base: base(0),
    base_inss: base(1),
    base_fgts: base(2),
    fgts: base(3),
    base_irrf: base(4),
  };
}

export type LeituraHolerites = { holerites: HoleriteLido[]; avisos: string[] };

// Lê todas as páginas de um arquivo. As duas vias do mesmo recibo viram uma só.
export function lerPaginasHolerite(paginas: Peca[][], arquivo = "arquivo"): LeituraHolerites {
  const porChave = new Map<string, HoleriteLido>();
  const avisos: string[] = [];
  paginas.forEach((pecas, i) => {
    const topos = pecas
      .filter((p) => p.s.trim() === "RECIBO DE PAGAMENTO")
      .map((p) => p.y)
      .sort((a, b) => b - a);
    topos.forEach((topo, j) => {
      // O recibo vai do próprio título (e do nome da empresa ao lado) até o título do próximo.
      const fim = topos[j + 1] ?? -Infinity;
      const doRecibo = pecas.filter((p) => p.y <= topo + PERTO && p.y > fim + PERTO);
      try {
        const h = lerRecibo(doRecibo, topo);
        const proventos = arred2(h.eventos.filter((e) => e.natureza === "provento").reduce((s, e) => s + e.valor, 0));
        const descontos = arred2(h.eventos.filter((e) => e.natureza === "desconto").reduce((s, e) => s + e.valor, 0));
        if (proventos !== h.total_proventos || descontos !== h.total_descontos) {
          avisos.push(
            `${arquivo}, página ${i + 1}: os eventos de ${h.nome} não somam os totais do recibo (proventos ${proventos} × ${h.total_proventos}, descontos ${descontos} × ${h.total_descontos}).`,
          );
        }
        porChave.set(`${h.empregador_cnpj}|${h.competencia}|${h.tipo}|${h.matricula}`, h);
      } catch (e) {
        avisos.push(`${arquivo}, página ${i + 1}: ${e instanceof Error ? e.message : String(e)}.`);
      }
    });
  });
  return { holerites: [...porChave.values()], avisos };
}

export async function lerPdfHolerites(arquivo: File): Promise<LeituraHolerites> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const paginas: Peca[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const conteudo = await (await pdf.getPage(p)).getTextContent();
    paginas.push(
      conteudo.items
        .filter((i) => "str" in i && i.str.trim())
        .map((i) => {
          const t = i as { str: string; transform: number[] };
          return { x: t.transform[4], y: t.transform[5], s: t.str };
        }),
    );
  }
  if (paginas.every((p) => p.length < 5)) {
    throw new Error(`${arquivo.name}: este PDF é uma imagem (digitalizado) e não tem texto para ler. Peça à contabilidade o PDF gerado pelo sistema da folha.`);
  }
  const lidos = lerPaginasHolerite(paginas, arquivo.name);
  if (!lidos.holerites.length) throw new Error(`${arquivo.name}: nenhum recibo de pagamento encontrado neste PDF.`);
  return lidos;
}

// -----------------------------------------------------------------------------
// Prévia da importação: o que vai mudar em cada empresa empregadora.
// -----------------------------------------------------------------------------
export type HoleriteArquivo = HoleriteLido & { arquivo: string };
export type EmpresaCnpj = { id: string; cnpj: string; nome: string };
export type FuncionarioExistente = {
  id: string;
  empresa_id: string;
  matricula: string;
  nome: string;
  cargo: string | null;
  salario_base: number | null;
  ativo: boolean;
};
export type MesImportado = { empresa_id: string; competencia: string; tipo: string; matriculas: string[] };

export type GrupoImportacao = {
  cnpj: string;
  empregador: string;
  empresa: EmpresaCnpj | null;
  holerites: HoleriteArquivo[];
  meses: { competencia: string; tipo: string; recibos: number; liquido: number; jaImportados: number }[];
  novos: { matricula: string; nome: string; cargo: string | null }[];
  mudancas: { matricula: string; nome: string; antes: string; depois: string }[];
  // Sem holerite no mês mais recente: candidatos a desligado.
  semHoleriteNoUltimoMes: { matricula: string; nome: string; ultimo: string | null }[];
  ultimoMes: string;
};

const chaveMes = (c: string) => c.slice(0, 7);

export function resumirImportacao(
  holerites: HoleriteArquivo[],
  empresas: EmpresaCnpj[],
  funcionarios: FuncionarioExistente[],
  meses: MesImportado[],
): GrupoImportacao[] {
  const porCnpj = new Map<string, HoleriteArquivo[]>();
  for (const h of holerites) porCnpj.set(h.empregador_cnpj, [...(porCnpj.get(h.empregador_cnpj) ?? []), h]);

  return [...porCnpj.entries()].map(([cnpj, lista]) => {
    const empresa = empresas.find((e) => e.cnpj === cnpj) ?? null;
    const doBanco = empresa ? funcionarios.filter((f) => f.empresa_id === empresa.id) : [];
    const mesesBanco = empresa ? meses.filter((m) => m.empresa_id === empresa.id) : [];
    const porMatricula = new Map(doBanco.map((f) => [f.matricula, f]));

    const resumo = new Map<string, GrupoImportacao["meses"][number]>();
    for (const h of lista) {
      const k = `${h.competencia}|${h.tipo}`;
      const ja = mesesBanco.find((m) => chaveMes(m.competencia) === h.competencia && m.tipo === h.tipo);
      const linha = resumo.get(k) ?? { competencia: h.competencia, tipo: h.tipo, recibos: 0, liquido: 0, jaImportados: 0 };
      linha.recibos++;
      linha.liquido = arred2(linha.liquido + h.liquido);
      if (ja?.matriculas.includes(h.matricula)) linha.jaImportados++;
      resumo.set(k, linha);
    }

    // Último recibo (de preferência mensal) de cada matrícula no lote.
    const ultimoDe = new Map<string, HoleriteArquivo>();
    for (const h of [...lista].sort((a, b) => a.competencia.localeCompare(b.competencia) || Number(a.tipo === "mensal") - Number(b.tipo === "mensal"))) {
      ultimoDe.set(h.matricula, h);
    }
    const ultimoMes = lista.reduce((m, h) => (h.competencia > m ? h.competencia : m), "");
    const ultimoBanco = mesesBanco.reduce((m, h) => (chaveMes(h.competencia) > m ? chaveMes(h.competencia) : m), "");

    const novos = [...ultimoDe.values()]
      .filter((h) => !porMatricula.has(h.matricula))
      .map((h) => ({ matricula: h.matricula, nome: h.nome, cargo: h.cargo }))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const mudancas: GrupoImportacao["mudancas"] = [];
    if (ultimoMes >= ultimoBanco) {
      for (const h of ultimoDe.values()) {
        const f = porMatricula.get(h.matricula);
        if (!f || h.tipo !== "mensal") continue;
        if (h.cargo && f.cargo && h.cargo !== f.cargo) mudancas.push({ matricula: h.matricula, nome: f.nome, antes: f.cargo, depois: h.cargo });
        if (h.salario_base && f.salario_base != null && arred2(h.salario_base) !== arred2(Number(f.salario_base))) {
          mudancas.push({
            matricula: h.matricula,
            nome: f.nome,
            antes: `salário ${Number(f.salario_base).toFixed(2).replace(".", ",")}`,
            depois: `salário ${h.salario_base.toFixed(2).replace(".", ",")}`,
          });
        }
      }
    }

    // Só sugere desligar quando o lote traz o mês mais recente da empresa.
    const semHoleriteNoUltimoMes: GrupoImportacao["semHoleriteNoUltimoMes"] = [];
    if (ultimoMes >= ultimoBanco) {
      const noUltimo = new Set(lista.filter((h) => h.competencia === ultimoMes).map((h) => h.matricula));
      for (const m of mesesBanco.filter((m) => chaveMes(m.competencia) === ultimoMes)) m.matriculas.forEach((x) => noUltimo.add(x));
      const ultimoBancoDe = (matricula: string) =>
        mesesBanco.filter((m) => m.matriculas.includes(matricula)).reduce((u, m) => (chaveMes(m.competencia) > u ? chaveMes(m.competencia) : u), "");
      for (const f of doBanco) {
        if (!f.ativo || noUltimo.has(f.matricula)) continue;
        const u = [ultimoDe.get(f.matricula)?.competencia ?? "", ultimoBancoDe(f.matricula)].sort().pop() || null;
        semHoleriteNoUltimoMes.push({ matricula: f.matricula, nome: f.nome, ultimo: u });
      }
      for (const n of novos) {
        if (!noUltimo.has(n.matricula)) semHoleriteNoUltimoMes.push({ matricula: n.matricula, nome: n.nome, ultimo: ultimoDe.get(n.matricula)!.competencia });
      }
      semHoleriteNoUltimoMes.sort((a, b) => a.nome.localeCompare(b.nome));
    }

    return {
      cnpj,
      empregador: lista[0].empregador_nome,
      empresa,
      holerites: lista,
      meses: [...resumo.values()].sort((a, b) => a.competencia.localeCompare(b.competencia) || a.tipo.localeCompare(b.tipo)),
      novos,
      mudancas,
      semHoleriteNoUltimoMes,
      ultimoMes,
    };
  });
}
