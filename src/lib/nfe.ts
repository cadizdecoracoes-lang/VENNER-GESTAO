// Leitura da NF-e do fornecedor no navegador: o XML traz tudo (cabeçalho,
// produtos e duplicatas); do PDF (DANFE) sai só o que dá para achar no texto,
// e a pessoa confere antes de salvar.

export type ItemNota = {
  codigo: string;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
};

export type Parcela = { vencimento: string; valor: number };

export type NotaLida = {
  origem: "xml" | "pdf";
  chave: string | null;
  numero: string;
  serie: string | null;
  data_emissao: string;
  emitente: { documento: string; nome: string; nome_fantasia: string | null; cidade: string | null; uf: string | null };
  destinatario_cnpj: string | null;
  valor_produtos: number;
  valor_frete: number;
  valor_desconto: number;
  valor_total: number;
  itens: ItemNota[];
  parcelas: Parcela[];
  // O que não foi encontrado no PDF e precisa ser preenchido.
  avisos: string[];
};

export function lerXmlNfe(texto: string): NotaLida {
  const doc = new DOMParser().parseFromString(texto, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("O arquivo não é um XML válido.");
  const inf = doc.getElementsByTagName("infNFe")[0];
  if (!inf) throw new Error("Este XML não é de uma NF-e (não tem o bloco infNFe).");

  const um = (pai: Element | Document | undefined, nome: string) => pai?.getElementsByTagName(nome)[0];
  const txt = (pai: Element | Document | undefined, nome: string) => um(pai, nome)?.textContent?.trim() || null;
  const num = (pai: Element | Document | undefined, nome: string) => Number(txt(pai, nome) ?? 0);

  const ide = um(inf, "ide");
  const emit = um(inf, "emit");
  const dest = um(inf, "dest");
  const tot = um(inf, "ICMSTot");
  const chave = (inf.getAttribute("Id") ?? "").replace(/\D/g, "") || txt(doc, "chNFe");

  const itens: ItemNota[] = [...inf.getElementsByTagName("det")].map((det) => {
    const prod = um(det, "prod");
    return {
      codigo: txt(prod, "cProd") ?? "",
      descricao: txt(prod, "xProd") ?? "",
      ncm: txt(prod, "NCM"),
      cfop: txt(prod, "CFOP"),
      unidade: txt(prod, "uCom"),
      quantidade: num(prod, "qCom"),
      valor_unitario: num(prod, "vUnCom"),
      valor_total: num(prod, "vProd"),
    };
  });

  const parcelas: Parcela[] = [...(um(inf, "cobr")?.getElementsByTagName("dup") ?? [])].map((d) => ({
    vencimento: txt(d, "dVenc") ?? "",
    valor: num(d, "vDup"),
  }));

  return {
    origem: "xml",
    chave: chave && chave.length === 44 ? chave : null,
    numero: txt(ide, "nNF") ?? "",
    serie: txt(ide, "serie"),
    data_emissao: (txt(ide, "dhEmi") ?? txt(ide, "dEmi") ?? "").slice(0, 10),
    emitente: {
      documento: txt(emit, "CNPJ") ?? txt(emit, "CPF") ?? "",
      nome: txt(emit, "xNome") ?? "",
      nome_fantasia: txt(emit, "xFant"),
      cidade: txt(um(emit, "enderEmit"), "xMun"),
      uf: txt(um(emit, "enderEmit"), "UF"),
    },
    destinatario_cnpj: txt(dest, "CNPJ") ?? txt(dest, "CPF"),
    valor_produtos: num(tot, "vProd"),
    valor_frete: num(tot, "vFrete"),
    valor_desconto: num(tot, "vDesc"),
    valor_total: num(tot, "vNF"),
    itens,
    parcelas,
    avisos: [],
  };
}

const lerValor = (v: string) => Number(v.replace(/\./g, "").replace(",", "."));
const dataIso = (v: string) => v.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");

// Texto do DANFE. A chave de acesso já traz CNPJ do emitente, série e número;
// o resto é procurado pelos rótulos do DANFE.
export function lerTextoDanfe(texto: string, cnpjsDoGrupo: string[]): NotaLida {
  const avisos: string[] = [];
  const corrido = texto.replace(/\s+/g, " ");

  const chave = corrido.match(/(?<!\d)(\d{4} ?){10}\d{4}(?!\d)/)?.[0].replace(/\D/g, "") ?? null;
  const emitente = chave ? chave.slice(6, 20) : "";
  const serie = chave ? String(Number(chave.slice(22, 25))) : null;
  const numero = chave ? String(Number(chave.slice(25, 34))) : "";
  if (!chave) avisos.push("Não achei a chave de acesso: preencha número, série e fornecedor.");

  const cnpjs = [...corrido.matchAll(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g)].map((m) => m[0].replace(/\D/g, ""));
  const destinatario = cnpjs.find((c) => c !== emitente && cnpjsDoGrupo.includes(c)) ?? null;
  if (!destinatario) avisos.push("Não achei o CNPJ da empresa compradora: escolha a empresa.");

  // Data de emissão: a primeira data do mês/ano da chave, ou a primeira do documento.
  const datas = [...corrido.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map((m) => m[0]);
  const daChave = chave ? datas.find((d) => d.slice(8, 10) + d.slice(3, 5) === chave.slice(2, 6)) : undefined;
  const emissao = daChave ?? datas[0];
  if (!emissao) avisos.push("Não achei a data de emissão.");

  const totalTxt = corrido.match(/VALOR TOTAL DA NOTA\D{0,40}?(\d{1,3}(?:\.\d{3})*,\d{2})/i)?.[1];
  if (!totalTxt) avisos.push("Não achei o valor total da nota.");

  // Duplicatas no quadro "Fatura": número, vencimento e valor.
  const parcelas = [...corrido.matchAll(/\b\d{3}\s+(\d{2}\/\d{2}\/\d{4})\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2})/g)].map((m) => ({
    vencimento: dataIso(m[1]),
    valor: lerValor(m[2]),
  }));

  const total = totalTxt ? lerValor(totalTxt) : 0;
  return {
    origem: "pdf",
    chave,
    numero,
    serie,
    data_emissao: emissao ? dataIso(emissao) : "",
    emitente: { documento: emitente, nome: "", nome_fantasia: null, cidade: null, uf: null },
    destinatario_cnpj: destinatario,
    valor_produtos: 0,
    valor_frete: 0,
    valor_desconto: 0,
    valor_total: total,
    itens: [],
    parcelas,
    avisos,
  };
}

export async function lerPdfDanfe(arquivo: File, cnpjsDoGrupo: string[]): Promise<NotaLida> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const partes: string[] = [];
  for (let p = 1; p <= Math.min(pdf.numPages, 5); p++) {
    const conteudo = await (await pdf.getPage(p)).getTextContent();
    partes.push(conteudo.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  const texto = partes.join(" ");
  if (texto.replace(/\s/g, "").length < 50) {
    throw new Error("Este PDF é uma imagem (digitalizado) e não tem texto para ler. Use o XML da nota ou preencha os dados à mão.");
  }
  return lerTextoDanfe(texto, cnpjsDoGrupo);
}
