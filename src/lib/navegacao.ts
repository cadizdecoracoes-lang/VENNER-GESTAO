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

export function revalidatePath(..._ignorados: string[]) {
  void _ignorados;
  guardados.clear();
  ouvintes.forEach((o) => o());
}

export function redirect(url: string): never {
  guardados.clear();
  if (navegar) navegar(url);
  else window.location.assign(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${url}`);
  return undefined as never;
}

export class NaoEncontrado extends Error {}

export function notFound(): never {
  throw new NaoEncontrado("Não encontrado");
}
