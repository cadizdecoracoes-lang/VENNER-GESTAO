-- Juntar conta bancária cadastrada duas vezes também quando as duas vieram
-- do Tiny (pedido do Alexandre, 23/11/2026: "Itaú" e "Banco Itaú" são a
-- mesma conta do Itaú, cadastrada duas vezes no próprio Tiny, e o mesmo
-- extrato foi importado e conciliado nas duas).
--
-- juntar_contas_bancarias(origem, destino) passa a aceitar duas contas do
-- Tiny. Nesse caso:
-- - a conta errada não é apagada: fica inativa, com o nome "... (juntada em
--   ...)" e o número do Tiny dela. Assim a leitura do Tiny não a cria de
--   novo, e título que o Tiny ainda tiver nela continua aparecendo nela;
-- - os títulos do Tiny NÃO mudam de conta (o Tiny vale): o que estiver
--   baixado na conta errada aparece na conciliação como "baixado em outra
--   conta: corrija no Tiny". Título lançado só aqui muda, como antes.
-- Em todos os casos, o extrato e as importações passam para a conta certa, e
-- a mesma linha do banco importada nas duas (mesma chave, ex.: o mesmo OFX)
-- fica uma só: vale a cópia já conciliada (ou ignorada); se as duas estão
-- resolvidas, vale a da conta certa; a outra sai com as ligações dela.
--
-- A junção do Itaú da Venner (Tiny 963875327 "Itaú" → 937141411 "Banco
-- Itaú") é feita no fim desta migração.

create or replace function public.juntar_contas_bancarias_interno(de_conta uuid, para_conta uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.contas_bancarias;
  b public.contas_bancarias;
  dois_tiny boolean;
  pagar integer;
  receber integer;
  linhas integer;
  imps integer;
  repetidas integer;
  sair uuid[];
begin
  if de_conta = para_conta then
    raise exception 'Escolha outra conta para receber os lançamentos';
  end if;
  select * into a from public.contas_bancarias where id = de_conta for update;
  select * into b from public.contas_bancarias where id = para_conta for update;
  if a.id is null or b.id is null then
    raise exception 'Conta bancária não encontrada';
  end if;
  if a.empresa_id <> b.empresa_id then
    raise exception 'As duas contas precisam ser da mesma empresa (CNPJ)';
  end if;
  dois_tiny := a.tiny_id is not null and b.tiny_id is not null;

  -- Títulos: com duas contas do Tiny, só os lançados aqui mudam (o Tiny vale).
  update public.contas_pagar set conta_bancaria_id = para_conta
  where conta_bancaria_id = de_conta and (not dois_tiny or tiny_id is null);
  get diagnostics pagar = row_count;
  update public.contas_receber set conta_bancaria_id = para_conta
  where conta_bancaria_id = de_conta and (not dois_tiny or tiny_id is null);
  get diagnostics receber = row_count;
  update public.extrato_conciliacoes set conta_anterior = para_conta where conta_anterior = de_conta;

  -- A mesma linha do banco nas duas contas (mesma chave): fica uma só.
  with pares as (
    select o.id as o_id, d.id as d_id,
      (o.situacao <> 'pendente' and d.situacao = 'pendente') as fica_a_da_origem
    from public.extrato_lancamentos o
    join public.extrato_lancamentos d on d.conta_bancaria_id = para_conta and d.chave = o.chave
    where o.conta_bancaria_id = de_conta
  )
  select array_agg(case when fica_a_da_origem then d_id else o_id end) into sair from pares;
  repetidas := coalesce(cardinality(sair), 0);
  if repetidas > 0 then
    perform public.devolver_conta_tiny(sair);
    delete from public.extrato_conciliacoes where lancamento_id = any(sair);
    delete from public.extrato_lancamentos where id = any(sair);
  end if;

  -- Mesma chave que sobrou (não deveria): ganha um sufixo para caber.
  update public.extrato_lancamentos l set chave = l.chave || '|junta:' || de_conta
  where l.conta_bancaria_id = de_conta
    and exists (select 1 from public.extrato_lancamentos d where d.conta_bancaria_id = para_conta and d.chave = l.chave);
  update public.extrato_lancamentos set conta_bancaria_id = para_conta where conta_bancaria_id = de_conta;
  get diagnostics linhas = row_count;
  update public.extrato_importacoes set conta_bancaria_id = para_conta where conta_bancaria_id = de_conta;
  get diagnostics imps = row_count;

  if dois_tiny then
    update public.contas_bancarias
    set ativa = false, nome = left(a.nome || ' (juntada em ' || b.nome || ')', 120)
    where id = de_conta;
  else
    if a.tiny_id is not null then
      update public.contas_bancarias set tiny_id = null where id = de_conta;
      update public.contas_bancarias set tiny_id = a.tiny_id where id = para_conta;
    end if;
    delete from public.contas_bancarias where id = de_conta;
  end if;
  if linhas > 0 or repetidas > 0 then
    perform public.marcar_repetidos_extrato(para_conta);
  end if;

  return jsonb_build_object('pagar', pagar, 'receber', receber, 'extrato', linhas, 'importacoes', imps,
    'repetidas', repetidas, 'inativada', dois_tiny);
end;
$$;
revoke execute on function public.juntar_contas_bancarias_interno(uuid, uuid) from public, anon, authenticated;

create or replace function public.juntar_contas_bancarias(origem uuid, destino uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.tem_permissao('financeiro.contas_bancarias', 'excluir') then
    raise exception 'Seu perfil não pode excluir conta bancária';
  end if;
  if not exists (select 1 from public.contas_bancarias c where c.id = juntar_contas_bancarias.origem and public.pode_ver_empresa(c.empresa_id))
    or not exists (select 1 from public.contas_bancarias c where c.id = juntar_contas_bancarias.destino and public.pode_ver_empresa(c.empresa_id)) then
    raise exception 'Conta bancária não encontrada';
  end if;
  return public.juntar_contas_bancarias_interno(juntar_contas_bancarias.origem, juntar_contas_bancarias.destino);
end;
$$;

-- Itaú da Venner: "Itaú" (Tiny 963875327) junta em "Banco Itaú" (Tiny 937141411).
do $$
declare
  o uuid := (select id from public.contas_bancarias where tiny_id = 963875327 and ativa);
  d uuid := (select id from public.contas_bancarias where tiny_id = 937141411);
begin
  if o is not null and d is not null then
    perform public.juntar_contas_bancarias_interno(o, d);
  end if;
end;
$$;
