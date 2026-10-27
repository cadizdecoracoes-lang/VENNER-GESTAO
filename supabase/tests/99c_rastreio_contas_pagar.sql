-- Testes da rastreabilidade das contas a pagar: origem, data de integração
-- com o Tiny e histórico com o antes e o depois de cada alteração.
\set ON_ERROR_STOP 1

create function pg_temp.esperar(condicao boolean, mensagem text) returns void language plpgsql as $$
begin
  if not coalesce(condicao, false) then raise exception 'FALHOU: %', mensagem; end if;
  raise notice 'ok: %', mensagem;
end $$;

create function pg_temp.esperar_erro(comando text, trecho text, mensagem text) returns void language plpgsql as $$
begin
  execute comando;
  raise exception 'FALHOU: %', mensagem;
exception when others then
  if sqlerrm like 'FALHOU%' or sqlerrm not like '%' || trecho || '%' then raise; end if;
  raise notice 'ok: %', mensagem;
end $$;

select set_config('teste.industria', id::text, false) from empresas where cnpj = '11111111000111';

-- Contas do Tiny (lidas no teste 95): criada pelo Tiny, com data de integração,
-- e o cancelamento por ter sido apagada lá aparece com o antes e o depois.
select pg_temp.esperar(
  (select h.origem = 'tiny' and h.usuario_nome = 'Tiny' and h.usuario_id is null and p.integrado_em is not null
   from contas_pagar p join contas_pagar_historico h on h.conta_id = p.id and h.evento = 'criada' where p.tiny_id = 10),
  'conta lida do Tiny nasce com origem Tiny e data de integração');
select pg_temp.esperar(
  (select h.mudancas -> 'Situação' = '["Em aberto", "Cancelado"]'::jsonb and h.origem = 'tiny'
   from contas_pagar p join contas_pagar_historico h on h.conta_id = p.id and h.evento = 'alterada' where p.tiny_id = 11),
  'apagada no Tiny: histórico mostra a situação de → para, feita pelo Tiny');

-- Conta lançada à mão pela Diretoria e depois corrigida.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into contas_pagar (empresa_id, descricao, valor, vencimento)
values (current_setting('teste.industria')::uuid, 'Conta de luz', 100, '2026-11-05');
select set_config('teste.conta', id::text, false) from contas_pagar where descricao = 'Conta de luz';
select pg_temp.esperar(
  (select origem = 'manual' and evento = 'criada' and usuario_nome = (select nome from usuarios where id = '00000000-0000-0000-0000-00000000000b')
   from contas_pagar_historico where conta_id = current_setting('teste.conta')::uuid),
  'lançada à mão: origem manual com o nome de quem lançou');
select pg_temp.esperar(
  (select integrado_em is null from contas_pagar where id = current_setting('teste.conta')::uuid),
  'conta daqui não tem data de integração');

update contas_pagar set valor = 120, vencimento = '2026-11-10' where id = current_setting('teste.conta')::uuid;
select pg_temp.esperar(
  (select mudancas = '{"Valor": ["100,00", "120,00"], "Vencimento": ["05/11/2026", "10/11/2026"]}'::jsonb and origem = 'manual'
   from contas_pagar_historico where conta_id = current_setting('teste.conta')::uuid and evento = 'alterada'),
  'edição guarda valor e vencimento de → para, em formato brasileiro');

update contas_pagar set descricao = 'Conta de luz' where id = current_setting('teste.conta')::uuid;
select pg_temp.esperar(
  (select count(*) from contas_pagar_historico where conta_id = current_setting('teste.conta')::uuid) = 2,
  'gravar sem mudar nada não cria linha');

select pg_temp.esperar_erro(
  $$insert into contas_pagar_historico (conta_id, evento, origem) values (current_setting('teste.conta')::uuid, 'criada', 'manual')$$,
  'permission denied', 'tela não grava histórico direto');
select pg_temp.esperar_erro(
  $$update contas_pagar_historico set usuario_nome = 'x'$$,
  'permission denied', 'histórico não é editado pela tela');

-- Quem não vê contas a pagar não vê o histórico.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000f';
select pg_temp.esperar(
  (select count(*) from contas_pagar_historico) = 0 or (select tem_permissao('financeiro.pagar', 'ver')),
  'sem acesso ao contas a pagar, histórico fica oculto');

-- A leitura do Tiny adota a conta lançada aqui: ganha o número e a data de integração.
-- (Chamada direta da gravação da leitura, como a Edge Function faz pelo robô.)
reset role;
update contas_pagar set fornecedor_id = (select fornecedor_id from contas_pagar where tiny_id = 11)
where id = current_setting('teste.conta')::uuid;
select tiny_aplicar((select integracao_id from integracao_robo limit 1), $${
  "listados": [{"tipo": "pagar", "id": 20, "assinatura": "a"}],
  "pagar": [{"id": 20, "situacao": "aberto", "emissao": "2026-10-20", "vencimento": "2026-11-10", "valor": 120,
             "descricao": "Energia novembro", "contato": {"id": 8001, "nome": "IMOBILIARIA X", "documento": "98765432000110"}}]
}$$::jsonb);
select pg_temp.esperar(
  (select tiny_id = 20 and integrado_em is not null from contas_pagar where id = current_setting('teste.conta')::uuid),
  'conta adotada pelo Tiny ganha a data de integração');
select pg_temp.esperar(
  (select origem = 'tiny' and mudancas -> 'Descrição' = '["Conta de luz", "Energia novembro"]'::jsonb and mudancas ? 'Número no Tiny'
   from contas_pagar_historico where conta_id = current_setting('teste.conta')::uuid order by quando desc, id limit 1),
  'mudança vinda do Tiny registra o de → para');
