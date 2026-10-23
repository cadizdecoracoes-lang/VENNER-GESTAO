-- Testes dos funcionários e da importação dos holerites.
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

-- Empregadora dos holerites e uma segunda empresa que o RH não enxerga.
insert into empresas (razao_social, cnpj, regime_tributario) values
  ('Prestadora de Serviços Teste', '22333444000155', 'simples_nacional'),
  ('Outra Empresa Teste', '99888777000166', 'simples_nacional');
select set_config('teste.empregadora', id::text, false) from empresas where cnpj = '22333444000155';
select set_config('teste.outra', id::text, false) from empresas where cnpj = '99888777000166';

-- financeiro@teste vira RH e enxerga só a empregadora; compras@teste segue sem RH.
update usuarios set perfil_id = (select id from perfis where nome = 'RH'), ativo = true where email = 'financeiro@teste';
delete from usuario_empresas where usuario_id = '00000000-0000-0000-0000-00000000000e';
insert into usuario_empresas values ('00000000-0000-0000-0000-00000000000e', current_setting('teste.empregadora')::uuid);

create temp table recibos as select $$[
  {"competencia": "2026-01", "tipo": "mensal", "matricula": "160", "nome": "FUNCIONARIO UM", "cbo": "784205",
   "cargo": "ALIMENTADOR LINHA DE PRODUÇÃO", "salario_base": 1980.87, "total_proventos": 132.06, "total_descontos": 9.90,
   "liquido": 122.16, "base_inss": 132.06, "base_fgts": 132.06, "fgts": 10.56, "base_irrf": 132.06, "arquivo": "01-2026 mensal.pdf",
   "eventos": [{"codigo": "1", "descricao": "Salário", "referencia": 2, "valor": 132.06, "natureza": "provento"},
               {"codigo": "11", "descricao": "INSS Sobre Salário", "referencia": 7.5, "valor": 9.90, "natureza": "desconto"}]},
  {"competencia": "2026-01", "tipo": "adiantamento", "matricula": "69", "nome": "FUNCIONARIA DOIS", "cbo": "414140",
   "cargo": "AUXILIAR DE LOGISTICA", "salario_base": 2093.18, "total_proventos": 837.27, "total_descontos": 0, "liquido": 837.27,
   "eventos": [{"codigo": "20", "descricao": "Adiantamento Crédito", "referencia": 40, "valor": 837.27, "natureza": "provento"}]},
  {"competencia": "2026-02", "tipo": "mensal", "matricula": "160", "nome": "FUNCIONARIO UM", "cbo": "784210",
   "cargo": "OPERADOR DE MAQUINA", "salario_base": 2500, "total_proventos": 2500, "total_descontos": 200, "liquido": 2300,
   "eventos": [{"codigo": "1", "descricao": "Salário", "referencia": 30, "valor": 2500, "natureza": "provento"},
               {"codigo": "11", "descricao": "INSS Sobre Salário", "referencia": 8, "valor": 200, "natureza": "desconto"}]}
]$$::jsonb as j;
grant select on recibos to authenticated;

-- Compras não importa.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar_erro(
  $$select importar_holerites(current_setting('teste.empregadora')::uuid, (select j from recibos))$$,
  'não pode importar', 'compras não importa holerites');
reset role;

-- RH importa: 2 funcionários, 3 recibos, 3 eventos novos da folha.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar_erro(
  $$select importar_holerites(current_setting('teste.outra')::uuid, (select j from recibos))$$,
  'não pode importar', 'RH não importa em empresa que não enxerga');
select pg_temp.esperar_erro(
  $$select importar_holerites(current_setting('teste.empregadora')::uuid, '[{"competencia": "2026-13", "tipo": "mensal", "matricula": "1", "nome": "X Y"}]')$$,
  'incompleto', 'recibo com mês inválido é recusado');
select pg_temp.esperar(
  importar_holerites(current_setting('teste.empregadora')::uuid, (select j from recibos))
    = '{"funcionarios_novos": 2, "holerites_novos": 3, "holerites_trocados": 0, "eventos_novos": 2, "desligados": 0}'::jsonb,
  'primeira importação cria funcionários, holerites e os eventos que faltavam');
select pg_temp.esperar((select count(*) from eventos_folha where codigo in ('1', '11', '20')) = 3, 'evento 1 já existia; 11 e 20 foram criados');
select pg_temp.esperar(
  (select cargo = 'OPERADOR DE MAQUINA' and cbo = '784210' and salario_base = 2500 from funcionarios where matricula = '160'),
  'cargo, CBO e salário seguem o holerite mensal mais recente');
select pg_temp.esperar(
  (select count(*) from holerite_eventos he join holerites h on h.id = he.holerite_id join funcionarios f on f.id = h.funcionario_id where f.matricula = '160') = 4,
  'eventos de cada recibo gravados');

-- Reimportar o mesmo mês troca o recibo (não duplica) e não volta o cargo para o de janeiro.
select pg_temp.esperar(
  importar_holerites(current_setting('teste.empregadora')::uuid, (select jsonb_build_array(j->0) from recibos),
                     array['69'])
    = '{"funcionarios_novos": 0, "holerites_novos": 0, "holerites_trocados": 1, "eventos_novos": 0, "desligados": 1}'::jsonb,
  'reimportação troca o recibo e desliga quem a tela marcou');
select pg_temp.esperar((select count(*) from holerites) = 3, 'nenhum recibo repetido');
select pg_temp.esperar(
  (select matriculas = '{160}' and recibos = 1 and liquido = 122.16 from holerites_por_mes where competencia = '2026-01-01' and tipo = 'mensal'),
  'resumo por mês mostra o que já foi importado');
select pg_temp.esperar(
  (select u.competencia from funcionarios_ultimo_holerite u join funcionarios f on f.id = u.funcionario_id where f.matricula = '160') = '2026-02-01',
  'último holerite de cada funcionário');
select pg_temp.esperar((select cargo from funcionarios where matricula = '160') = 'OPERADOR DE MAQUINA', 'janeiro reimportado não volta o cargo');
select pg_temp.esperar(not (select ativo from funcionarios where matricula = '69'), 'funcionária marcada ficou inativa');

-- Cadastro à mão.
update funcionarios set cpf = '12345678901', admissao = '2025-03-10' where matricula = '160';
select pg_temp.esperar_erro(
  $$update funcionarios set desligamento = '2025-01-01' where matricula = '160'$$,
  'check', 'desligamento antes da admissão é recusado');
select pg_temp.esperar_erro(
  $$insert into funcionarios (empresa_id, matricula, nome) values (current_setting('teste.empregadora')::uuid, '160', 'Outro')$$,
  'duplicate', 'matrícula não se repete na mesma empresa');
select pg_temp.esperar_erro(
  $$insert into funcionarios (empresa_id, matricula, nome) values (current_setting('teste.outra')::uuid, '500', 'Outro')$$,
  'row-level security', 'RH não cadastra em empresa que não enxerga');
reset role;

-- Contabilidade consulta funcionários e holerites, mas não altera.
update usuarios set perfil_id = (select id from perfis where nome = 'Contabilidade') where email = 'financeiro@teste';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar((select count(*) from funcionarios) = 2 and (select count(*) from holerites) = 3, 'contabilidade consulta funcionários e holerites');
update funcionarios set nome = 'Mudou' where matricula = '160';
select pg_temp.esperar((select nome from funcionarios where matricula = '160') = 'FUNCIONARIO UM', 'contabilidade não altera o cadastro');
select pg_temp.esperar_erro(
  $$select importar_holerites(current_setting('teste.empregadora')::uuid, (select j from recibos))$$,
  'não pode importar', 'contabilidade não importa holerites');
reset role;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.esperar((select count(*) from funcionarios) = 0 and (select count(*) from holerites) = 0
  and (select count(*) from holerites_por_mes) = 0, 'compras não vê funcionários nem holerites');
reset role;
