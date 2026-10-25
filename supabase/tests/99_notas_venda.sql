-- Testes da nota fiscal de venda pelo Tiny: quem emite, acesso entregue à
-- Edge Function, gravação das respostas do Tiny, uma nota valendo por pedido,
-- cancelamento e arquivos no Storage.
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
select set_config('teste.pedido', id::text, false) from pedidos_venda where tiny_id = 100;
select set_config('teste.pedido2', id::text, false) from pedidos_venda where tiny_id = 101;
select set_config('teste.pedido_local', id::text, false) from pedidos_venda
  where tiny_id is null and empresa_id = current_setting('teste.industria')::uuid limit 1;
select pg_temp.esperar(current_setting('teste.pedido_local') <> '', 'há pedido lançado aqui para o teste');

-- Diretoria recebe o acesso ao Tiny da empresa do pedido.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  (select (a ->> 'pedido_tiny')::bigint = 100 and a ->> 'access_token' = 'acesso-2' and a ->> 'client_secret' = 'segredo-do-aplicativo'
     and a -> 'nota' = 'null'::jsonb and a ->> 'empresa_id' = current_setting('teste.industria')
   from nf_venda_acesso(current_setting('teste.pedido')::uuid) a),
  'função recebe o acesso, o pedido no Tiny e nenhuma nota');
select pg_temp.esperar_erro($$select nf_venda_acesso(current_setting('teste.pedido_local')::uuid)$$, 'não existe no Tiny',
  'pedido lançado aqui ainda não fatura pelo Tiny');
select pg_temp.esperar_erro($$insert into notas_venda (empresa_id, pedido_id, tiny_id) values (current_setting('teste.industria')::uuid, current_setting('teste.pedido')::uuid, 1)$$,
  'permission denied', 'tela não grava nota direto');

-- Nota gerada no Tiny, depois autorizada.
select set_config('teste.nota',
  nf_venda_gravar(current_setting('teste.pedido')::uuid, '{"tiny_id": 555, "numero": "0", "serie": "1", "modelo": 55, "situacao_tiny": 1}')::text, false);
select pg_temp.esperar(
  (select situacao = 'gerada' and numero is null and serie = '1' and usuario_id is not null from notas_venda where id = current_setting('teste.nota')::uuid),
  'nota gerada fica como gerada, sem número');
select pg_temp.esperar(
  nf_venda_gravar(current_setting('teste.pedido')::uuid, '{"tiny_id": 555, "situacao_tiny": 5, "mensagem": "Rejeição 209"}')
    = current_setting('teste.nota')::uuid,
  'a mesma nota do Tiny não duplica');
select pg_temp.esperar(
  (select situacao = 'rejeitada' and mensagem = 'Rejeição 209' from notas_venda where id = current_setting('teste.nota')::uuid),
  'rejeição guarda o motivo');
select nf_venda_gravar(current_setting('teste.pedido')::uuid,
  '{"tiny_id": 555, "situacao_tiny": 6, "numero": "000123", "valor": 1500, "emitida_em": "2026-10-25", "contas_lancadas": true,
    "danfe_arquivo": "x/nota.pdf", "xml_arquivo": "x/nota.xml"}');
select pg_temp.esperar(
  (select situacao = 'autorizada' and numero = '123' and mensagem is null and valor = 1500 and contas_lancadas and serie = '1'
   from notas_venda where id = current_setting('teste.nota')::uuid),
  'autorizada: número sem zeros, mensagem limpa, campos antigos mantidos');
select pg_temp.esperar(
  (select nota_fiscal = '123' from pedidos_venda where id = current_setting('teste.pedido')::uuid),
  'pedido recebe o número da nota');
select pg_temp.esperar(
  (select a -> 'nota' ->> 'situacao' = 'autorizada' from nf_venda_acesso(current_setting('teste.pedido')::uuid) a),
  'função vê a nota atual do pedido');
select pg_temp.esperar((select count(*) from notas_venda) = 1, 'tela vê a nota');
select pg_temp.esperar_erro(
  $$select nf_venda_gravar(current_setting('teste.pedido')::uuid, '{"tiny_id": 556, "situacao_tiny": 1}')$$,
  'notas_venda_uma_por_pedido', 'uma nota valendo por pedido');
select pg_temp.esperar_erro(
  $$select nf_venda_gravar(current_setting('teste.pedido2')::uuid, '{"tiny_id": 555}')$$,
  'outro pedido', 'nota de um pedido não vai para outro');

-- Cancelada: libera emitir outra.
select nf_venda_gravar(current_setting('teste.pedido')::uuid,
  '{"tiny_id": 555, "situacao_tiny": 3, "justificativa_cancelamento": "Cliente desistiu da compra"}');
select pg_temp.esperar(
  (select situacao = 'cancelada' and justificativa_cancelamento = 'Cliente desistiu da compra' from notas_venda where tiny_id = 555)
  and (select nota_fiscal is null from pedidos_venda where id = current_setting('teste.pedido')::uuid),
  'cancelamento tira o número do pedido');
select nf_venda_gravar(current_setting('teste.pedido')::uuid, '{"tiny_id": 556, "situacao_tiny": 1}');
select pg_temp.esperar(
  (select a -> 'nota' ->> 'tiny_id' = '556' from nf_venda_acesso(current_setting('teste.pedido')::uuid) a),
  'a nota nova é a atual do pedido');

-- Acesso renovado pela emissão.
select nf_venda_tokens(current_setting('teste.pedido')::uuid, 'acesso-3', null, now() + interval '4 hours');
reset role;
select pg_temp.esperar(
  (select access_token = 'acesso-3' and refresh_token = 'renova-2' from integracoes_plataforma where canal = 'tiny'),
  'acesso renovado guardado, renovação mantida');
select pg_temp.esperar(situacao_nf_tiny(9) = 'enviada' and situacao_nf_tiny(7) = 'autorizada' and situacao_nf_tiny(99) is null,
  'tabela de situações do Tiny');

-- Arquivos: Diretoria guarda, Compras não.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into storage.objects (bucket_id, name) values ('notas-venda', current_setting('teste.industria') || '/nota.pdf');
select pg_temp.esperar((select count(*) from storage.objects where bucket_id = 'notas-venda') = 1, 'Diretoria guarda e vê o DANFE');

-- Compras não emite nem lê o acesso.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar_erro($$select nf_venda_acesso(current_setting('teste.pedido')::uuid)$$, 'não', 'Compras não emite nota');
select pg_temp.esperar_erro(
  $$select nf_venda_gravar(current_setting('teste.pedido')::uuid, '{"tiny_id": 556, "situacao_tiny": 6}')$$, 'não',
  'Compras não grava nota');
select pg_temp.esperar_erro(
  $$insert into storage.objects (bucket_id, name) values ('notas-venda', current_setting('teste.industria') || '/outra.pdf')$$,
  'row-level security', 'Compras não guarda arquivo de nota');
reset role;
