"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { Filtro } from "@/components/filtro";
import { FormAcao } from "@/components/form-acao";
import {
  CabecalhoTela,
  Campo,
  Cartao,
  Celula,
  Etiqueta,
  LinkAcao,
  SemAcesso,
  Tabela,
  estiloBotao,
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { MENU, PAINEL } from "@/lib/menu";
import { ACOES } from "@/lib/rotulos";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteNavegador } from "@/lib/supabase/client";
import { excluirPerfil, salvarPerfil } from "./actions";
import { TelaCliente } from "@/components/tela-cliente";

const TELA = "config.perfis";

type Perfil = {
  id: string;
  nome: string;
  descricao: string | null;
  todas_empresas: boolean;
  perfil_permissoes: { tela_codigo: string; acao: string }[];
};

// Grupos da matriz de permissões, na mesma ordem do menu.
const GRUPOS = [{ titulo: "Painel", telas: [PAINEL] }, ...MENU.map((g) => ({ titulo: g.titulo, telas: g.telas }))];

async function carregar() {
  if (!supabaseConfigurado) return { perfis: [] as Perfil[], usuarios: [] as { perfil_id: string | null }[] };
  const supabase = criarClienteNavegador();
  const [r1, r2] = await Promise.all([
    supabase.from("perfis").select("id, nome, descricao, todas_empresas, perfil_permissoes(tela_codigo, acao)").order("nome"),
    supabase.from("usuarios").select("perfil_id"),
  ]);
  return { perfis: (r1.data ?? []) as Perfil[], usuarios: (r2.data ?? []) as { perfil_id: string | null }[] };
}

function MatrizPermissoes({ marcadas, travada }: { marcadas: Set<string>; travada: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-texto-suave">
            <th className="px-4 py-2 font-medium">Tela</th>
            {Object.values(ACOES).map((a) => (
              <th key={a} className="px-3 py-2 text-center font-medium">
                {a}
              </th>
            ))}
          </tr>
        </thead>
        {GRUPOS.map((g) => (
          <tbody key={g.titulo} className="divide-y divide-borda/70">
            <tr className="bg-fundo/70">
              <td colSpan={6} className="px-4 py-1.5 text-xs font-medium text-texto-suave">
                {g.titulo}
              </td>
            </tr>
            {g.telas.map((t) => (
              <tr key={t.codigo}>
                <td className="px-4 py-1.5">{t.titulo}</td>
                {Object.keys(ACOES).map((a) => {
                  const chave = `${t.codigo}:${a}`;
                  return (
                    <td key={a} className="px-3 py-1.5 text-center">
                      <input
                        type="checkbox"
                        name="permissoes"
                        value={chave}
                        defaultChecked={travada || marcadas.has(chave)}
                        disabled={travada}
                        aria-label={`${t.titulo}: ${ACOES[a as keyof typeof ACOES]}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

async function PaginaPerfis({ searchParams }: { searchParams: Promise<{ editar?: string; novo?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const { editar, novo } = await searchParams;
  const { perfis, usuarios } = await carregar();
  const emEdicao = editar ? perfis.find((p) => p.id === editar) : undefined;
  const mostrarForm = (novo && pode(acesso, TELA, "criar")) || (emEdicao && pode(acesso, TELA, "editar"));
  const travada = !!emEdicao?.todas_empresas;
  const marcadas = new Set((emEdicao?.perfil_permissoes ?? []).map((p) => `${p.tela_codigo}:${p.acao}`));
  const qtdUsuarios = (id: string) => usuarios.filter((u) => u.perfil_id === id).length;

  return (
    <div className="space-y-3">
      <CabecalhoTela codigo={TELA}>
        {pode(acesso, TELA, "criar") && !mostrarForm && (
          <Link href="?novo=1" className={estiloBotao}>
            <Plus size={16} /> Novo perfil
          </Link>
        )}
      </CabecalhoTela>

      {mostrarForm && (
        <Cartao
          titulo={emEdicao ? `Perfil ${emEdicao.nome}` : "Novo perfil de acesso"}
          acoes={
            emEdicao &&
            !travada &&
            pode(acesso, TELA, "excluir") && (
              <FormAcao
                acao={excluirPerfil.bind(null, emEdicao.id)}
                rotulo="Excluir perfil"
                enviando="Excluindo..."
                secundario
                confirmar={`Excluir o perfil ${emEdicao.nome}?`}
              />
            )
          }
        >
          <FormAcao
            extra={
              <Link href="/config/perfis" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            }
            key={emEdicao?.id ?? "novo"}
            acao={salvarPerfil.bind(null, emEdicao?.id ?? null, travada)}
            rotulo="Salvar"
            className="space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Nome">
                <input name="nome" required defaultValue={emEdicao?.nome} className={estiloCampo} />
              </Campo>
              <Campo rotulo="Descrição" className="sm:col-span-2">
                <input name="descricao" defaultValue={emEdicao?.descricao ?? ""} className={estiloCampo} />
              </Campo>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-texto-suave">
                {travada
                  ? "Este perfil tem acesso total e enxerga todos os CNPJs. As permissões dele não podem ser retiradas, para o sistema nunca ficar sem quem o administre."
                  : 'Marque o que este perfil pode fazer em cada tela. Sem "Ver", a tela some do menu.'}
              </p>
              <MatrizPermissoes marcadas={marcadas} travada={travada} />
            </div>
          </FormAcao>
        </Cartao>
      )}

      <Filtro>
        <Tabela colunas={["Perfil", "Descrição", "Telas", "Usuários", ""]} vazio="Nenhum perfil cadastrado ainda.">
          {perfis.map((p) => {
            const telas = new Set(p.perfil_permissoes.filter((x) => x.acao === "ver").map((x) => x.tela_codigo)).size;
            return (
              <tr key={p.id}>
                <Celula className="font-medium">
                  {p.nome} {p.todas_empresas && <Etiqueta cor="primaria">Acesso total</Etiqueta>}
                </Celula>
                <Celula className="text-texto-suave">{p.descricao ?? "—"}</Celula>
                <Celula className="tabular-nums">{telas}</Celula>
                <Celula className="tabular-nums">{qtdUsuarios(p.id)}</Celula>
                <Celula className="text-right">
                  {pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${p.id}`}>Editar</LinkAcao>}
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}

export default function Pagina() {
  return <TelaCliente montar={PaginaPerfis} />;
}
