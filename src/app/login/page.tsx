"use client";

import { useActionState } from "react";
import { entrar, type EstadoLogin } from "./actions";

export default function PaginaLogin() {
  const [estado, acao, enviando] = useActionState<EstadoLogin, FormData>(entrar, {});

  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <form
        action={acao}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-borda bg-superficie p-8 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">Venner Gestão</h1>
          <p className="text-sm text-texto-suave">Entre com seu e-mail e senha.</p>
        </div>
        <label className="block space-y-1 text-sm">
          <span>E-mail</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-lg border border-borda px-3 py-2 outline-none focus:border-primaria"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Senha</span>
          <input
            name="senha"
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-borda px-3 py-2 outline-none focus:border-primaria"
          />
        </label>
        {estado.erro && <p className="text-sm text-perigo">{estado.erro}</p>}
        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-lg bg-primaria py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {enviando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
