-- =============================================================================
-- Venner Gestão · Contas a pagar: juros, multa e desconto separados; lotes
--
-- Pedido do Alexandre (09/11/2026), tela Contas a pagar:
-- - Ao pagar, o valor de juros e multa fica separado do principal. Novas
--   colunas juros, multa e desconto (só valem com a conta paga). valor_pago
--   continua sendo o total que saiu do banco (principal + juros + multa -
--   desconto), como já usam a conciliação e o fluxo de caixa.
-- - Lançamento parcelado ou recorrente: as contas geradas juntas ganham o
--   mesmo grupo_id, para achar o conjunto depois.
-- - Quando a conta deixa de estar paga (estorno, conciliação desfeita, Tiny),
--   juros, multa e desconto são limpos pelo gatilho; nenhuma rotina antiga
--   precisa mudar.
-- - O histórico da conta passa a mostrar juros, multa e desconto.
-- =============================================================================

alter table public.contas_pagar
  add column juros numeric(14, 2) check (juros >= 0),
  add column multa numeric(14, 2) check (multa >= 0),
  add column desconto numeric(14, 2) check (desconto >= 0),
  add column grupo_id uuid;
create index contas_pagar_grupo_idx on public.contas_pagar (grupo_id) where grupo_id is not null;

create function public.limpar_encargos_pagar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.situacao <> 'pago' then
    new.juros := null;
    new.multa := null;
    new.desconto := null;
  end if;
  return new;
end;
$$;
create trigger limpar_encargos before insert or update on public.contas_pagar
  for each row execute function public.limpar_encargos_pagar();

-- Texto legível dos campos novos no histórico.
create or replace function public.rastreio_pagar_texto(campo text, valor text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when valor is null then null
    when campo = 'fornecedor_id' then (select coalesce(nullif(f.nome_fantasia, ''), f.nome) from public.fornecedores f where f.id = valor::uuid)
    when campo = 'categoria_id' then (select c.codigo || ' · ' || c.nome from public.plano_contas c where c.id = valor::uuid)
    when campo = 'centro_custo_id' then (select c.codigo || ' · ' || c.nome from public.centros_custo c where c.id = valor::uuid)
    when campo = 'conta_bancaria_id' then (select b.nome from public.contas_bancarias b where b.id = valor::uuid)
    when campo = 'empresa_id' then (select coalesce(nullif(e.nome_fantasia, ''), e.razao_social) from public.empresas e where e.id = valor::uuid)
    when campo in ('valor', 'valor_pago', 'juros', 'multa', 'desconto') then replace(valor::numeric(14, 2)::text, '.', ',')
    when campo in ('vencimento', 'data_pagamento') then to_char(valor::date, 'DD/MM/YYYY')
    when campo = 'situacao' then case valor when 'aberto' then 'Em aberto' when 'pago' then 'Pago' when 'cancelado' then 'Cancelado' else valor end
    else valor
  end;
$$;
revoke execute on function public.rastreio_pagar_texto(text, text) from public, anon, authenticated;

create or replace function public.rastrear_conta_pagar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pilha text;
  origem text;
  quem uuid := auth.uid();
  mudou jsonb := '{}';
  campo text;
  rotulo text;
  antes text;
  depois text;
begin
  get diagnostics pilha = pg_context;
  origem := case
    when pilha like '%tiny_aplicar%' then 'tiny'
    when tg_op = 'INSERT' and new.nota_id is not null then 'nota'
    when quem is not null then 'manual'
    else 'sistema'
  end;
  if origem = 'tiny' then quem := null; end if;

  if tg_op = 'UPDATE' then
    for campo, rotulo in
      select * from (values
        ('empresa_id', 'Empresa'), ('fornecedor_id', 'Fornecedor'), ('descricao', 'Descrição'), ('parcela', 'Parcela'),
        ('categoria_id', 'Categoria'), ('centro_custo_id', 'Centro de custo'), ('valor', 'Valor'), ('vencimento', 'Vencimento'),
        ('situacao', 'Situação'), ('data_pagamento', 'Data do pagamento'), ('valor_pago', 'Valor pago'),
        ('juros', 'Juros'), ('multa', 'Multa'), ('desconto', 'Desconto'),
        ('conta_bancaria_id', 'Conta bancária'), ('observacao', 'Observação'), ('tiny_id', 'Número no Tiny')
      ) c(campo, rotulo)
    loop
      antes := to_jsonb(old) ->> campo;
      depois := to_jsonb(new) ->> campo;
      if antes is distinct from depois then
        mudou := mudou || jsonb_build_object(rotulo,
          jsonb_build_array(public.rastreio_pagar_texto(campo, antes), public.rastreio_pagar_texto(campo, depois)));
      end if;
    end loop;
    if mudou = '{}' then return null; end if;
  end if;

  insert into public.contas_pagar_historico (conta_id, evento, origem, usuario_id, usuario_nome, mudancas)
  values (new.id, case tg_op when 'INSERT' then 'criada' else 'alterada' end, origem, quem,
    case when origem = 'tiny' then 'Tiny' else (select u.nome from public.usuarios u where u.id = quem) end, mudou);
  return null;
end;
$$;
revoke execute on function public.rastrear_conta_pagar() from public, anon, authenticated;
