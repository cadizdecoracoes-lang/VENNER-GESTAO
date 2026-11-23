-- Testes da migração 20261123000070 (vários extratos de uma vez): a
-- importação guarda a conta lida no arquivo (para a tela reconhecer a conta
-- da próxima vez), as chamadas antigas continuam valendo e o mesmo arquivo
-- importado de novo não repete lançamentos.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

-- Como o 99u: o perfil de teste já não vê esta conta a esta altura; roda como dono.
select set_config('teste.conta', id::text, false) from contas_bancarias where nome = 'Itaú movimento';


-- Arquivo com a conta escrita: fica guardada na importação.
select set_config('teste.imp1', importar_extrato(current_setting('teste.conta')::uuid, 'pdf', 'sicoob julho.pdf',
  '[{"data": "2027-07-01", "descricao": "PIX RECEBIDO", "valor": 100},
    {"data": "2027-07-02", "descricao": "TARIFA", "valor": -3}]'::jsonb, null, 'Sicoob|3333|12345-6')::text, false);
select pg_temp.esperar(
  (select conta_no_arquivo = 'Sicoob|3333|12345-6' from extrato_importacoes
   where id = (current_setting('teste.imp1')::jsonb ->> 'importacao')::uuid),
  'importação guarda banco, agência e conta lidos do arquivo');

-- Chamada antiga (sem a conta do arquivo) continua valendo.
select set_config('teste.imp2', importar_extrato(current_setting('teste.conta')::uuid, 'ofx', 'antigo.ofx',
  '[{"data": "2027-07-03", "descricao": "PIX ENVIADO", "valor": -50}]'::jsonb)::text, false);
select pg_temp.esperar(
  (current_setting('teste.imp2')::jsonb ->> 'importadas')::int = 1
  and (select conta_no_arquivo is null from extrato_importacoes where id = (current_setting('teste.imp2')::jsonb ->> 'importacao')::uuid),
  'chamada sem a conta do arquivo importa e deixa a conta em branco');

-- O mesmo arquivo de novo, junto com outros: nada se repete.
select set_config('teste.imp3', importar_extrato(current_setting('teste.conta')::uuid, 'pdf', 'sicoob julho (cópia).pdf',
  '[{"data": "2027-07-01", "descricao": "PIX RECEBIDO", "valor": 100},
    {"data": "2027-07-02", "descricao": "TARIFA", "valor": -3}]'::jsonb, null, '  ')::text, false);
select pg_temp.esperar(
  (current_setting('teste.imp3')::jsonb ->> 'importadas')::int = 0 and (current_setting('teste.imp3')::jsonb ->> 'repetidas')::int = 2,
  'mesmo arquivo de novo: 0 novos, 2 já estavam');
select pg_temp.esperar(
  (select conta_no_arquivo is null from extrato_importacoes where id = (current_setting('teste.imp3')::jsonb ->> 'importacao')::uuid),
  'conta do arquivo em branco não é guardada');
