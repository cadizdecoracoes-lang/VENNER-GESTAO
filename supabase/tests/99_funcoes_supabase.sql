-- Testes das integrações nas Edge Functions: estado da autorização guardado no
-- banco (ligar conta) e troca do endereço do robô do Tiny para o Supabase.
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
select set_config('teste.estado', repeat('e', 40), false);
select set_config('teste.verificador', repeat('v', 43), false);

-- Diretoria liga a conta do Mercado Livre.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar_erro(
  $$select iniciar_ligacao('mercado_livre', current_setting('teste.industria')::uuid, 'https://site.exemplo/x?y=1', current_setting('teste.estado'), current_setting('teste.verificador'))$$,
  'volta inválido', 'endereço de volta com parâmetros é recusado');
select pg_temp.esperar_erro(
  $$select iniciar_ligacao('mercado_livre', current_setting('teste.industria')::uuid, 'javascript:alert(1)', current_setting('teste.estado'), current_setting('teste.verificador'))$$,
  'volta inválido', 'endereço de volta estranho é recusado');
select iniciar_ligacao('mercado_livre', current_setting('teste.industria')::uuid,
  'https://cadizdecoracoes-lang.github.io/VENNER-GESTAO/config/integracoes', current_setting('teste.estado'), current_setting('teste.verificador'));
select pg_temp.esperar_erro($$select * from ligacoes_pendentes$$, 'permission denied', 'tela não lê o verificador direto');
reset role;

-- Contabilidade não liga contas.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000011';
select pg_temp.esperar_erro(
  $$select iniciar_ligacao('shopee', current_setting('teste.industria')::uuid, 'https://site.exemplo/config/integracoes', repeat('f', 40), repeat('g', 43))$$,
  'não pode ligar', 'perfil sem permissão não começa ligação');
-- Nem termina a de outra pessoa.
select pg_temp.esperar(
  (select count(*) from concluir_ligacao(current_setting('teste.estado'), 'mercado_livre')) = 0,
  'outra pessoa não pega o verificador');
reset role;

-- Volta da plataforma (sem login): só o endereço da tela.
set role anon;
select pg_temp.esperar(
  destino_ligacao(current_setting('teste.estado')) = 'https://cadizdecoracoes-lang.github.io/VENNER-GESTAO/config/integracoes',
  'volta sem login acha a tela');
select pg_temp.esperar(destino_ligacao('nao-existe') is null, 'estado desconhecido não volta para lugar nenhum');
select pg_temp.esperar_erro(
  $$select * from concluir_ligacao(current_setting('teste.estado'), 'mercado_livre')$$,
  'permission denied', 'sem login não termina a ligação');
reset role;

-- Quem começou termina, uma vez só e no mesmo canal.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  (select count(*) from concluir_ligacao(current_setting('teste.estado'), 'shopee')) = 0,
  'estado de outro canal não serve');
select pg_temp.esperar(
  (select verificador from concluir_ligacao(current_setting('teste.estado'), 'mercado_livre')) = current_setting('teste.verificador'),
  'quem começou recebe o verificador');
select pg_temp.esperar(
  (select count(*) from concluir_ligacao(current_setting('teste.estado'), 'mercado_livre')) = 0,
  'o mesmo retorno não é usado duas vezes');
-- Autorização velha não vale.
select iniciar_ligacao('tiny', current_setting('teste.industria')::uuid, 'http://localhost:3000/config/integracoes', repeat('h', 40), repeat('i', 43));
reset role;
update ligacoes_pendentes set criada_em = now() - interval '16 minutes' where estado = repeat('h', 40);
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(destino_ligacao(repeat('h', 40)) is null, 'autorização de mais de 15 minutos não volta');
select pg_temp.esperar(
  (select count(*) from concluir_ligacao(repeat('h', 40), 'tiny')) = 0,
  'autorização de mais de 15 minutos não termina');
reset role;

-- Robô do Tiny: só a função robo-tiny (chave de serviço) troca o endereço.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar_erro(
  $$select registrar_endereco_robo('https://abcdefghijklmnopqrst.supabase.co')$$,
  'permission denied', 'tela não troca o endereço do robô');
reset role;
select set_config('teste.contas_tiny', count(*)::text, false) from integracao_robo;
set role service_role;
select pg_temp.esperar_erro(
  $$select registrar_endereco_robo('https://outro.exemplo.dev')$$, 'inválido', 'só endereço do Supabase');
select pg_temp.esperar(
  registrar_endereco_robo('https://abcdefghijklmnopqrst.supabase.co') = current_setting('teste.contas_tiny')::integer
  and current_setting('teste.contas_tiny')::integer > 0,
  'contas do Tiny passam para a função do Supabase');
select pg_temp.esperar(registrar_endereco_robo('https://abcdefghijklmnopqrst.supabase.co') = 0, 'registrar de novo não muda nada');
reset role;
select pg_temp.esperar(
  (select bool_and(endereco = 'https://abcdefghijklmnopqrst.supabase.co') from integracao_robo),
  'endereço guardado é o do Supabase');
