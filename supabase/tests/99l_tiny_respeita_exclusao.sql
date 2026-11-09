-- Testes: título excluído ou cancelado na Venner não volta pela leitura do Tiny.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.robo', (select integracao_id::text from integracao_robo limit 1), false);

-- Excluído aqui (título 31 do teste 99h): fica guardado e o Tiny não recria.
delete from contas_pagar where tiny_id = 31;
select pg_temp.esperar((select count(*) = 1 from tiny_excluidos where tipo = 'pagar' and tiny_id = 31), 'exclusão fica guardada');
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "pagar": [{"id": 31, "situacao": "aberto", "emissao": "2026-11-01", "vencimento": "2026-12-06", "valor": 777,
             "descricao": "Do Tiny", "contato": {"id": 8001, "nome": "IMOBILIARIA X"}}]
}$$::jsonb);
select pg_temp.esperar(not exists (select 1 from contas_pagar where tiny_id = 31), 'excluído aqui não volta pelo Tiny');

-- Cancelado aqui (receber 40 do teste 99h): o Tiny em aberto não reabre.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update contas_receber set situacao = 'cancelado' where tiny_id = 40;
reset role;
select tiny_aplicar(current_setting('teste.robo')::uuid, $${
  "receber": [{"id": 40, "situacao": "aberto", "emissao": "2026-11-01", "vencimento": "2026-11-27", "valor": 950,
               "descricao": "Venda 40", "contato": {"id": 9001, "nome": "CLIENTE QUARENTA"}}]
}$$::jsonb);
select pg_temp.esperar((select situacao = 'cancelado' from contas_receber where tiny_id = 40), 'cancelado aqui fica cancelado');

-- Quem vê contas a pagar enxerga a lista de excluídos.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar((select count(*) >= 1 from tiny_excluidos), 'Diretoria vê os excluídos');
reset role;
