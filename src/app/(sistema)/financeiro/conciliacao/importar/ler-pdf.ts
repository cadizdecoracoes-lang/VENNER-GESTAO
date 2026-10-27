// Tira o texto do extrato em PDF, no navegador, em linhas com a posição de
// cada pedaço (para o leitor de cada banco em src/lib/extrato-pdf.ts).
// PDF "impresso" (Microsoft Print to PDF, imprimir da tela do banco) não tem
// texto, só desenho: aí cada página vira imagem e passa pelo OCR (tesseract.js,
// que baixa o leitor e o português na primeira vez).
import { agruparLinhas, type LinhaPdf } from "@/lib/extrato-pdf";

const MAX_PAGINAS = 40;
// 300 dpi: abaixo disso o OCR erra mais os números.
const ESCALA_OCR = 300 / 72;

type Pdf = Awaited<ReturnType<typeof import("pdfjs-dist")["getDocument"]>["promise"]>;

export async function linhasDoPdf(f: File, progresso: (texto: string) => void): Promise<{ linhas: LinhaPdf[]; ocr: boolean }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
  const paginas = Math.min(pdf.numPages, MAX_PAGINAS);
  const itens: { pagina: number; x: number; y: number; t: string }[] = [];
  for (let p = 1; p <= paginas; p++) {
    const pagina = await pdf.getPage(p);
    const altura = pagina.getViewport({ scale: 1 }).height;
    for (const i of (await pagina.getTextContent()).items) {
      if ("str" in i && i.str.trim()) itens.push({ pagina: p, x: i.transform[4], y: altura - i.transform[5], t: i.str });
    }
  }
  if (itens.map((i) => i.t).join("").replace(/\s/g, "").length >= 30) return { linhas: agruparLinhas(itens), ocr: false };
  return { linhas: await lerPorImagem(pdf, paginas, progresso), ocr: true };
}

async function lerPorImagem(pdf: Pdf, paginas: number, progresso: (texto: string) => void): Promise<LinhaPdf[]> {
  progresso("O PDF é uma imagem: preparando a leitura de imagem (na primeira vez demora um pouco)...");
  const { createWorker } = await import("tesseract.js");
  const leitor = await createWorker("por").catch(() => {
    throw new Error("Não foi possível carregar a leitura de imagem (precisa de internet). Tente de novo ou baixe o extrato em OFX ou Excel.");
  });
  try {
    // Bloco único de texto: mantém cada linha do extrato inteira.
    await leitor.setParameters({ tessedit_pageseg_mode: "6" as never, preserve_interword_spaces: "1" });
    const itens: { pagina: number; x: number; y: number; t: string; c: number }[] = [];
    for (let p = 1; p <= paginas; p++) {
      progresso(`Lendo a imagem da página ${p} de ${paginas}...`);
      const pagina = await pdf.getPage(p);
      const viewport = pagina.getViewport({ scale: ESCALA_OCR });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await pagina.render({ canvas, viewport }).promise;
      pretoNoBranco(canvas);
      const r = await leitor.recognize(canvas, {}, { blocks: true });
      for (const b of r.data.blocks ?? [])
        for (const par of b.paragraphs)
          for (const l of par.lines)
            for (const w of l.words)
              itens.push({ pagina: p, x: w.bbox.x0 / ESCALA_OCR, y: (w.bbox.y0 + w.bbox.y1) / 2 / ESCALA_OCR, t: w.text, c: w.confidence });
      canvas.width = canvas.height = 0;
    }
    if (!itens.length) throw new Error("Não conseguimos ler este PDF. Baixe o extrato em OFX, Excel ou o PDF original do internet banking.");
    return agruparLinhas(itens, 4);
  } finally {
    await leitor.terminate();
  }
}

// Texto colorido (valores em vermelho/azul) vira preto e o fundo cinza das
// linhas zebradas vira branco: o OCR lê bem melhor.
function pretoNoBranco(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i + 3] > 127 && Math.min(d[i], d[i + 1], d[i + 2]) < 204 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
