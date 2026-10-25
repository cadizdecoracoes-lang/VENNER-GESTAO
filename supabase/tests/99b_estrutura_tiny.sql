-- Testes da estrutura vinda do Tiny: o kit 10001 (produto 3001, criado pelo
-- pedido em 95_tiny.sql) ganha ficha técnica com a matéria-prima, o tipo
-- segue o Tiny e a ficha feita aqui não é trocada.
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

select set_config('teste.tiny', id::text, false) from integracoes_plataforma where canal = 'tiny' limit 1;
-- Suporte já cadastrado (veio num pedido) como produto acabado.
select tiny_item('{"produto_id": 3102, "sku": "SP19", "descricao": "Suporte 19 mm"}');

select pg_temp.esperar(
  not exists (select 1 from fichas_tecnicas f join itens i on i.id = f.item_id where i.tiny_id = 3001),
  'kit vindo do pedido ainda sem ficha');
select pg_temp.esperar((select tipo from itens where tiny_id = 3102) = 'produto_acabado', 'suporte começa como produto acabado');

-- Leitura do produto: kit com varão, suporte (2 linhas somadas) e ele mesmo (ignorado).
select tiny_aplicar(current_setting('teste.tiny')::uuid, $${
  "produtos": [
    {"produto_id": 3001, "sku": "10001", "descricao": "KIT VARÃO 1,50 BRANCO", "tipo_item": "produto_acabado", "tipo_tiny": "K",
     "estrutura": [{"produto_id": 3101, "sku": "VR19-150", "descricao": "Varão 19 mm 1,50", "quantidade": 1},
                   {"produto_id": 3102, "sku": "SP19", "descricao": "Suporte 19 mm", "quantidade": 1},
                   {"produto_id": 3102, "sku": "SP19", "descricao": "Suporte 19 mm", "quantidade": 1},
                   {"produto_id": 3001, "sku": "10001", "quantidade": 1}]},
    {"produto_id": 3103, "sku": "PT19", "descricao": "Ponteira 19 mm", "tipo_item": "materia_prima", "tipo_tiny": "M", "estrutura": []}
  ]
}$$::jsonb);

select pg_temp.esperar(
  (select f.status = 'ativa' and f.origem = 'tiny' and f.versao = 1 from fichas_tecnicas f join itens i on i.id = f.item_id where i.tiny_id = 3001),
  'estrutura do Tiny vira ficha ativa');
select pg_temp.esperar(
  (select string_agg(i.codigo || '=' || c.quantidade::numeric(10, 2), ',' order by i.codigo)
   from ficha_componentes c join fichas_tecnicas f on f.id = c.ficha_id join itens p on p.id = f.item_id join itens i on i.id = c.componente_id
   where p.tiny_id = 3001) = 'SP19=2.00,VR19-150=1.00',
  'componentes somados, sem o próprio kit');
select pg_temp.esperar((select tipo from itens where tiny_id = 3101) = 'materia_prima', 'componente novo nasce como matéria-prima');
select pg_temp.esperar((select tipo from itens where tiny_id = 3102) = 'materia_prima', 'componente sem ficha vira matéria-prima');
select pg_temp.esperar((select tipo from itens where tiny_id = 3103) = 'materia_prima', 'tipo M do Tiny é matéria-prima');
select pg_temp.esperar(current_setting('venner.leitura_tiny', true) = '', 'aviso da leitura desligado no fim');

-- Mesma estrutura de novo: nada muda. Estrutura nova: nova versão, a anterior substituída.
select tiny_aplicar(current_setting('teste.tiny')::uuid, $${"produtos": [
  {"produto_id": 3001, "sku": "10001", "tipo_tiny": "K",
   "estrutura": [{"produto_id": 3101, "quantidade": 1}, {"produto_id": 3102, "quantidade": 2}]}]}$$::jsonb);
select pg_temp.esperar(
  (select count(*) from fichas_tecnicas f join itens i on i.id = f.item_id where i.tiny_id = 3001) = 1, 'mesma estrutura não cria versão');
select tiny_aplicar(current_setting('teste.tiny')::uuid, $${"produtos": [
  {"produto_id": 3001, "sku": "10001", "tipo_tiny": "K",
   "estrutura": [{"produto_id": 3101, "quantidade": 1}, {"produto_id": 3102, "quantidade": 2}, {"produto_id": 3103, "quantidade": 2}]}]}$$::jsonb);
select pg_temp.esperar(
  (select string_agg(f.versao || ':' || f.status, ',' order by f.versao) from fichas_tecnicas f join itens i on i.id = f.item_id
   where i.tiny_id = 3001) = '1:substituida,2:ativa',
  'estrutura alterada no Tiny vira nova versão');

-- Ficha editada aqui (nova versão manual) não é trocada pelo Tiny. Quem edita
-- é pcp@teste, que virou Diretoria nos testes anteriores.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  (select origem from fichas_tecnicas f join itens i on i.id = f.item_id where i.tiny_id = 3001 and f.status = 'ativa') = 'tiny',
  'tela vê a origem da ficha');
select ativar_ficha(nova_versao_ficha((select id from itens where tiny_id = 3001)));
reset role;
select pg_temp.esperar(
  (select origem = 'manual' and versao = 3 from fichas_tecnicas f join itens i on i.id = f.item_id where i.tiny_id = 3001 and f.status = 'ativa'),
  'nova versão feita aqui é manual');
select tiny_aplicar(current_setting('teste.tiny')::uuid, $${"produtos": [
  {"produto_id": 3001, "sku": "10001", "tipo_tiny": "K", "estrutura": [{"produto_id": 3101, "quantidade": 5}]}]}$$::jsonb);
select pg_temp.esperar(
  (select versao from fichas_tecnicas f join itens i on i.id = f.item_id where i.tiny_id = 3001 and f.status = 'ativa') = 3,
  'Tiny não troca a ficha feita aqui');

-- Ficha fechada continua travada para quem não é a leitura do Tiny.
select pg_temp.esperar_erro(
  $$update fichas_tecnicas set origem = 'tiny' where status = 'ativa' and item_id = (select id from itens where tiny_id = 3001)$$,
  'Só o rascunho', 'origem da ficha ativa não muda');

-- Estrutura circular no Tiny não para a leitura.
select tiny_aplicar(current_setting('teste.tiny')::uuid, $${"produtos": [
  {"produto_id": 3101, "sku": "VR19-150", "tipo_tiny": "F", "estrutura": [{"produto_id": 3001, "quantidade": 1}]}]}$$::jsonb);
select pg_temp.esperar(
  not exists (select 1 from fichas_tecnicas f join itens i on i.id = f.item_id where i.tiny_id = 3101),
  'estrutura circular é ignorada sem erro');
select pg_temp.esperar((select tipo from itens where tiny_id = 3101) = 'produto_acabado', 'fabricado no Tiny é produto acabado');
