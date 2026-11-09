// O sistema roda todo no navegador (páginas estáticas no GitHub Pages). Este
// módulo faz o papel do que antes era do servidor do Next:
// - revalidatePath: depois de salvar, limpa os dados guardados e manda a tela
//   aberta buscar de novo (o caminho é ignorado: só a tela aberta é refeita);
// - redirect: vai para outra tela (a ação termina sem devolver estado);
// - notFound: a tela mostra "não encontrado".
// Mantém os nomes do Next para as ações das telas continuarem iguais.

type Ouvinte = () => void;
const ouvintes = new Set<Ouvinte>();
const guardados = new Map<() => unknown, Promise<unknown>>();
let navegar: ((url: string) => void) | null = null;

// A tela aberta escuta para buscar os dados de novo.
export function aoRecarregar(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => void ouvintes.delete(ouvinte);
}

// O layout entrega a navegação do Next (que já soma o endereço base do site).
export function registrarNavegacao(fn: (url: string) => void) {
  navegar = fn;
}

// Consulta guardada até a próxima gravação (acesso, empresas): evita repetir a
// mesma leitura em cada tela.
export function guardado<T>(consulta: () => Promise<T>): () => Promise<T> {
  const chamar = () => {
    let p = guardados.get(chamar) as Promise<T> | undefined;
    if (!p) {
      p = consulta();
      guardados.set(chamar, p);
      p.catch(() => guardados.delete(chamar));
    }
    return p;
  };
  return chamar;
}

// Mesma ideia, separada por chave (ex.: o id da conta) e por pouco tempo:
// trocar de filtro na tela não busca de novo o que não depende do filtro, e o
// que outra pessoa (ou o robô do Tiny) mudou aparece em até `segundos`.
const porChave = new Map<string, { p: Promise<unknown>; ate: number }>();
let proximoGrupo = 0;
export function guardadoPor<T>(consulta: (chave: string) => Promise<T>, segundos = 120): (chave: string) => Promise<T> {
  const grupo = `${proximoGrupo++}:`;
  return (chave: string) => {
    const k = grupo + chave;
    const agora = Date.now();
    const achado = porChave.get(k);
    if (achado && achado.ate > agora) return achado.p as Promise<T>;
    const p = consulta(chave);
    porChave.set(k, { p, ate: agora + segundos * 1000 });
    p.catch(() => porChave.delete(k));
    return p;
  };
}

export function revalidatePath(..._ignorados: string[]) {
  void _ignorados;
  guardados.clear();
  porChave.clear();
  ouvintes.forEach((o) => o());
}

export function redirect(url: string): never {
  guardados.clear();
  porChave.clear();
  if (navegar) navegar(url);
  else window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${url}`);
  return undefined as never;
}

export class NaoEncontrado extends Error {}

export function notFound(): never {
  throw new NaoEncontrado("Não encontrado");
}
