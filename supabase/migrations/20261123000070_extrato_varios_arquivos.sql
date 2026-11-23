-- Importar vários extratos de uma vez, com a conta de cada arquivo achada
-- sozinha.
--
-- A tela de importação agora aceita vários arquivos (PDF, OFX, Excel e CSV,
-- de bancos e meses diferentes) e acha a conta de cada um pelo número da
-- conta, pelo banco e pelo CNPJ escritos no arquivo. Quando a conta
-- cadastrada não tem o número (a maioria vem do Tiny só com o nome), a tela
-- aprende: guarda na importação o banco, a agência e a conta lidos do
-- arquivo, e da próxima vez o arquivo com esse número vai sozinho para a
-- mesma conta.
--
-- Muda:
-- - extrato_importacoes.conta_no_arquivo: "banco|agência|conta" como veio no
--   arquivo (só leitura para a tela; não mexe na conta cadastrada, que é do
--   Tiny);
-- - importar_extrato ganha o parâmetro conta_no_arquivo (opcional; chamadas
--   antigas continuam valendo). A regra de não repetir lançamento é a mesma.
-- A tabela já está no Realtime (20261109000031_telas_ao_vivo.sql).

alter table public.extrato_importacoes add column conta_no_arquivo text;

drop function public.importar_extrato(uuid, public.origem_extrato, text, jsonb, numeric);

create function public.importar_extrato(
  conta_bancaria uuid,
  origem public.origem_extrato,
  arquivo text,
  linhas jsonb,
  saldo_final numeric default null,
  conta_no_arquivo text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  empresa uuid;
  imp uuid;
  l jsonb;
  base text;
  ocorrencias jsonb := '{}';
  n integer;
  novas integer := 0;
  total integer := 0;
  inseridas integer;
begin
  select b.empresa_id into empresa from public.contas_bancarias b where b.id = conta_bancaria;
  if empresa is null then
    raise exception 'Conta bancária não encontrada';
  end if;
  if jsonb_typeof(linhas) <> 'array' or jsonb_array_length(linhas) = 0 then
    raise exception 'O extrato não tem lançamentos';
  end if;

  insert into public.extrato_importacoes (empresa_id, conta_bancaria_id, origem, arquivo, saldo_final, periodo_de, periodo_ate, conta_no_arquivo)
  values (empresa, conta_bancaria, origem, arquivo, saldo_final,
    (select min((x ->> 'data')::date) from jsonb_array_elements(linhas) x),
    (select max((x ->> 'data')::date) from jsonb_array_elements(linhas) x),
    nullif(left(trim(importar_extrato.conta_no_arquivo), 120), ''))
  returning id into imp;

  for l in select * from jsonb_array_elements(linhas) loop
    if coalesce((l ->> 'valor')::numeric, 0) = 0 then
      continue;
    end if;
    total := total + 1;
    if nullif(l ->> 'id_banco', '') is not null then
      base := 'id:' || (l ->> 'id_banco');
    else
      -- Duas tarifas iguais no mesmo dia são lançamentos diferentes: conta a ocorrência.
      base := (l ->> 'data') || '|' || round((l ->> 'valor')::numeric, 2) || '|'
        || lower(regexp_replace(trim(l ->> 'descricao'), '\s+', ' ', 'g'));
      n := coalesce((ocorrencias ->> base)::integer, 0) + 1;
      ocorrencias := ocorrencias || jsonb_build_object(base, n);
      base := base || '|' || n;
    end if;
    insert into public.extrato_lancamentos (empresa_id, conta_bancaria_id, importacao_id, data, descricao, documento, valor, saldo, chave)
    values (empresa, conta_bancaria, imp, (l ->> 'data')::date, coalesce(nullif(trim(l ->> 'descricao'), ''), 'Sem descrição'),
      nullif(trim(l ->> 'documento'), ''), round((l ->> 'valor')::numeric, 2), round((l ->> 'saldo')::numeric, 2), base)
    on conflict (conta_bancaria_id, chave) do nothing;
    get diagnostics inseridas = row_count;
    novas := novas + inseridas;
  end loop;

  -- O mesmo lançamento que já veio em outra importação (outro formato ou
  -- descrição escrita diferente) fica de fora da lista de pendentes.
  perform public.marcar_repetidos_extrato(conta_bancaria);
  select count(*) into inseridas from public.extrato_lancamentos
  where importacao_id = imp and situacao = 'ignorado' and observacao = public.motivo_repetido_extrato();
  novas := novas - inseridas;

  update public.extrato_importacoes set importadas = novas, repetidas = total - novas where id = imp;
  return jsonb_build_object('importadas', novas, 'repetidas', total - novas, 'importacao', imp);
end;
$$;
revoke execute on function public.importar_extrato(uuid, public.origem_extrato, text, jsonb, numeric, text) from public, anon;
grant execute on function public.importar_extrato(uuid, public.origem_extrato, text, jsonb, numeric, text) to authenticated;
