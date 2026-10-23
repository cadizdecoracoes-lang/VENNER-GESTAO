import Link from "next/link";
import type { ReactNode } from "react";

// Cartão central usado nas telas de entrada (login, esqueci a senha, senha nova).
export function Moldura({ subtitulo, children }: { subtitulo: string; children: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-borda bg-superficie p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">Venner Gestão</h1>
          <p className="text-sm text-texto-suave">{subtitulo}</p>
        </div>
        {children}
      </div>
    </main>
  );
}

export function CampoEntrada({ rotulo, ...props }: { rotulo: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{rotulo}</span>
      <input {...props} required className="w-full rounded-lg border border-borda px-3 py-2 outline-none focus:border-primaria" />
    </label>
  );
}

export function BotaoEntrada({ enviando, rotulo, rotuloEnviando }: { enviando: boolean; rotulo: string; rotuloEnviando: string }) {
  return (
    <button
      type="submit"
      disabled={enviando}
      className="w-full rounded-lg bg-primaria py-2 text-sm font-medium text-white disabled:opacity-60"
    >
      {enviando ? rotuloEnviando : rotulo}
    </button>
  );
}

export function LinkEntrada({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p className="text-center text-sm">
      <Link href={href} className="text-primaria hover:underline">
        {children}
      </Link>
    </p>
  );
}

export function Mensagens({ erro, aviso }: { erro?: string; aviso?: string }) {
  return (
    <>
      {erro && <p className="text-sm text-perigo">{erro}</p>}
      {aviso && <p className="text-sm text-sucesso">{aviso}</p>}
    </>
  );
}
