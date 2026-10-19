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
  estiloBotaoSecundario,
  estiloCampo,
} from "@/components/ui";
import { carregarAcesso, pode } from "@/lib/acesso";
import { formatarData } from "@/lib/formato";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { criarClienteServidor } from "@/lib/supabase/server";
import { salvarUsuario } from "./actions";

const TELA = "config.usuarios";

type Perfil = { id: string; nome: string; descricao: string | null; todas_empresas: boolean };
type Empresa = { id: string; nome_fantasia: string | null; razao_social: string };
type Usuario = {
  id: string;
  nome: string;
  email: string;
  ativo: boolean;
  perfil_id: string | null;
  criado_em: string;
  usuario_empresas: { empresa_id: string }[];
};

async function carregar() {
  if (!supabaseConfigurado) return { usuarios: [] as Usuario[], perfis: [] as Perfil[], empresas: [] as Empresa[] };
  const supabase = await criarClienteServidor();
  const [r1, r2, r3] = await Promise.all([
    supabase.from("usuarios").select("id, nome, email, ativo, perfil_id, criado_em, usuario_empresas(empresa_id)").order("nome"),
    supabase.from("perfis").select("id, nome, descricao, todas_empresas").order("nome"),
    supabase.from("empresas").select("id, nome_fantasia, razao_social").eq("ativa", true).order("razao_social"),
  ]);
  return { usuarios: (r1.data ?? []) as Usuario[], perfis: (r2.data ?? []) as Perfil[], empresas: (r3.data ?? []) as Empresa[] };
}

export default async function PaginaUsuarios({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const acesso = await carregarAcesso();
  if (!pode(acesso, TELA, "ver")) return <SemAcesso codigo={TELA} />;

  const { editar } = await searchParams;
  const { usuarios, perfis, empresas } = await carregar();
  const emEdicao = editar && pode(acesso, TELA, "editar") ? usuarios.find((u) => u.id === editar) : undefined;
  const nomePerfil = (id: string | null) => perfis.find((p) => p.id === id);
  const nomeEmpresa = (id: string) => {
    const e = empresas.find((x) => x.id === id);
    return e ? (e.nome_fantasia ?? e.razao_social) : null;
  };
  // Quem ainda não foi liberado aparece primeiro.
  const ordenados = [...usuarios].sort((a, b) => Number(a.ativo) - Number(b.ativo));
  const aguardando = usuarios.filter((u) => !u.ativo).length;

  return (
    <div className="space-y-6">
      <CabecalhoTela codigo={TELA} />

      <p className="rounded-xl bg-primaria-suave px-4 py-2.5 text-sm text-primaria">
        O login de uma pessoa nova é criado no Supabase (Authentication → Users → Add user). Ele aparece aqui como &quot;aguardando
        liberação&quot;; escolha o perfil, os CNPJs e libere o acesso.
      </p>

      {emEdicao && (
        <Cartao titulo={`Acesso de ${emEdicao.nome}`}>
          <FormAcao key={emEdicao.id} acao={salvarUsuario.bind(null, emEdicao.id)} rotulo="Salvar" className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome">
                <input name="nome" required defaultValue={emEdicao.nome} className={estiloCampo} />
              </Campo>
              <Campo rotulo="E-mail">
                <input value={emEdicao.email} disabled className={estiloCampo} />
              </Campo>
              <Campo rotulo="Perfil de acesso" dica="Define quais telas e ações a pessoa usa.">
                <select name="perfil_id" defaultValue={emEdicao.perfil_id ?? ""} className={estiloCampo}>
                  <option value="">Sem perfil</option>
                  {perfis.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                      {p.descricao ? ` · ${p.descricao}` : ""}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <fieldset className="space-y-2 text-sm">
              <legend className="text-texto-suave">CNPJs que a pessoa enxerga</legend>
              <p className="text-xs text-texto-suave">
                Perfis com acesso a todas as empresas, como a Diretoria, enxergam todos os CNPJs mesmo sem marcar.
              </p>
              {empresas.length === 0 && <p className="text-texto-suave">Nenhuma empresa cadastrada ainda.</p>}
              <div className="flex flex-wrap gap-4">
                {empresas.map((e) => (
                  <label key={e.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="empresas"
                      value={e.id}
                      defaultChecked={emEdicao.usuario_empresas.some((ue) => ue.empresa_id === e.id)}
                    />
                    {e.nome_fantasia ?? e.razao_social}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex items-center justify-between gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="ativo" defaultChecked={emEdicao.ativo} />
                Acesso liberado
              </label>
              <Link href="/config/usuarios" className={estiloBotaoSecundario}>
                Cancelar
              </Link>
            </div>
          </FormAcao>
        </Cartao>
      )}

      {aguardando > 0 && !emEdicao && (
        <p className="text-sm text-alerta">
          {aguardando === 1 ? "1 pessoa aguardando liberação." : `${aguardando} pessoas aguardando liberação.`}
        </p>
      )}

      <Filtro
        atalhos={[
          {
            rotulo: "Situação",
            opcoes: [
              { valor: "liberado", rotulo: "Liberados" },
              { valor: "aguardando", rotulo: "Aguardando liberação" },
            ],
          },
        ]}
      >
        <Tabela colunas={["Nome", "E-mail", "Perfil", "CNPJs", "Situação", "Desde", ""]} vazio="Nenhum usuário ainda.">
          {ordenados.map((u) => {
            const perfil = nomePerfil(u.perfil_id);
            return (
              <tr key={u.id} data-tags={u.ativo ? "liberado" : "aguardando"}>
                <Celula className="font-medium">{u.nome}</Celula>
                <Celula className="text-texto-suave">{u.email}</Celula>
                <Celula>{perfil?.nome ?? <span className="text-texto-suave">—</span>}</Celula>
                <Celula className="text-texto-suave">
                  {perfil?.todas_empresas
                    ? "Todos"
                    : u.usuario_empresas
                        .map((ue) => nomeEmpresa(ue.empresa_id))
                        .filter(Boolean)
                        .join(", ") || "—"}
                </Celula>
                <Celula>
                  {u.ativo ? <Etiqueta cor="sucesso">Liberado</Etiqueta> : <Etiqueta cor="alerta">Aguardando liberação</Etiqueta>}
                </Celula>
                <Celula className="text-texto-suave">{formatarData(u.criado_em)}</Celula>
                <Celula className="text-right">
                  {pode(acesso, TELA, "editar") && <LinkAcao href={`?editar=${u.id}`}>{u.ativo ? "Editar" : "Liberar"}</LinkAcao>}
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Filtro>
    </div>
  );
}
