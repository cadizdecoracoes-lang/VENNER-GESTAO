import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">Tela não encontrada</h1>
      <Link href="/" className="text-primaria underline">
        Voltar ao painel
      </Link>
    </main>
  );
}
