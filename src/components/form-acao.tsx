"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { Estado } from "@/lib/erros";
import { estiloBotao, estiloBotaoSecundario } from "./ui";

// Formulário ligado a uma ação do servidor. Mostra o erro sem apagar o que foi
// digitado; com `limpar`, esvazia os campos depois de salvar (inclusão em lista).
export function FormAcao({
  acao,
  rotulo,
  enviando = "Salvando...",
  limpar = false,
  secundario = false,
  discreto = false,
  confirmar,
  className,
  extra,
  children,
}: {
  acao: (estado: Estado, form: FormData) => Promise<Estado>;
  rotulo: React.ReactNode;
  enviando?: string;
  limpar?: boolean;
  secundario?: boolean;
  // Botão em forma de link, para ações de linha de tabela (cancelar, estornar).
  discreto?: boolean;
  confirmar?: string;
  className?: string;
  // Ao lado do botão de enviar (ex.: o "Cancelar"), para não gastar uma linha a mais.
  extra?: React.ReactNode;
  children?: React.ReactNode;
}) {
  // Ação que termina indo para outra tela (redirect) não devolve estado.
  const [resultado, enviar, pendente] = useActionState(acao, {});
  const estado: Estado = resultado ?? {};
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (limpar && estado.ok) form.current?.reset();
  }, [estado.ok, limpar]);

  return (
    <form
      ref={form}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirmar && !window.confirm(confirmar)) return;
        const dados = new FormData(e.currentTarget);
        startTransition(() => enviar(dados));
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pendente}
          className={
            discreto ? "text-sm text-texto-suave hover:text-perigo disabled:opacity-60" : secundario ? estiloBotaoSecundario : estiloBotao
          }
        >
          {pendente ? enviando : rotulo}
        </button>
        {extra}
        {estado.erro && <p className="text-sm text-perigo">{estado.erro}</p>}
      </div>
    </form>
  );
}
