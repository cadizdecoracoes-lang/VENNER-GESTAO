-- Testes dos benefícios fora do holerite (VT e auxílio-alimentação):
-- importar troca o mês, liga pelo CPF, acesso pelo rh.folha e ajuda de custo
-- do contas a pagar para os indicadores.
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

select set_config('teste.ben_emp', id::text, false) from empresas where cnpj = '11111111000111';
insert into funcionarios (empresa_id, matricula, nome, cpf, setor)
values (current_setting('teste.ben_emp')::uuid, 'BEN1', 'FUNCIONARIA DO VT', '11122233344', 'producao'),
       (current_setting('teste.ben_emp')::uuid, 'BEN2', 'JOSÉ DA CONCEIÇÃO PEREIRA', null, 'logistica'),
       (current_setting('teste.ben_emp')::uuid, 'BEN3', 'ANA MARIA SOUZA LIMA', null, 'comercial');

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_beneficios(current_setting('teste.ben_emp')::uuid, 'vt', '2030-09-01', $j$[
  {"nome": "Funcionaria do VT", "cpf": "111.222.333-44", "valor": 240, "periodo_de": "2030-09-03", "periodo_ate": "2030-10-01"},
  {"nome": "Sem cadastro", "cpf": null, "valor": 180, "observacao": "FÉRIAS 15 DIAS"}
]$j$::jsonb);
select pg_temp.esperar((select count(*) = 2 and sum(valor) = 420 from beneficios_folha where competencia = '2030-09-01'), 'VT gravado');
select pg_temp.esperar(
  (select f.setor = 'producao' from beneficios_folha b join funcionarios f on f.id = b.funcionario_id where b.cpf = '11122233344'),
  'ligado ao funcionário pelo CPF');
-- Reimportar o mesmo mês troca, não duplica.
select importar_beneficios(current_setting('teste.ben_emp')::uuid, 'vt', '2030-09-01',
  $j$[{"nome": "Funcionaria do VT", "cpf": "11122233344", "valor": 264}]$j$::jsonb);
select pg_temp.esperar((select count(*) = 1 and sum(valor) = 264 from beneficios_folha where competencia = '2030-09-01' and tipo = 'vt'), 'reimportar troca o mês');
select importar_beneficios(current_setting('teste.ben_emp')::uuid, 'va', '2030-09-01',
  $j$[{"nome": "Funcionaria do VT", "cpf": "11122233344", "valor": 350, "observacao": "Agendado"}]$j$::jsonb);
select pg_temp.esperar(
  (select sum(valor) filter (where tipo = 'vt') = 264 and sum(valor) filter (where tipo = 'va') = 350 and bool_and(setor = 'producao')
   from folha_beneficios_mensal where competencia = '2030-09-01'),
  'resumo por mês, tipo e setor');
reset role;

-- Sem CPF no cadastro (o holerite não traz): liga pelo nome completo ou pelo
-- primeiro e último nome, e o CPF da planilha completa o cadastro.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select importar_beneficios(current_setting('teste.ben_emp')::uuid, 'vt', '2030-08-01', $j$[
  {"nome": "Jose da Conceicao  Pereira ", "cpf": "222.333.444-55", "valor": 200},
  {"nome": "ANA AP LIMA", "cpf": null, "valor": 100},
  {"nome": "PESSOA DESCONHECIDA", "cpf": null, "valor": 50}
]$j$::jsonb);
reset role;
select pg_temp.esperar(
  (select f.matricula = 'BEN2' and f.cpf = '22233344455' from beneficios_folha b join funcionarios f on f.id = b.funcionario_id
   where b.competencia = '2030-08-01' and b.valor = 200),
  'liga pelo nome sem acento e completa o CPF');
select pg_temp.esperar(
  (select f.matricula = 'BEN3' from beneficios_folha b join funcionarios f on f.id = b.funcionario_id where b.competencia = '2030-08-01' and b.valor = 100),
  'liga pelo primeiro e último nome');
select pg_temp.esperar(
  (select funcionario_id is null from beneficios_folha where competencia = '2030-08-01' and valor = 50),
  'sem nome parecido fica fora do cadastro');

-- Sem rh.folha: não vê nem importa.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.esperar((select count(*) = 0 from beneficios_folha), 'sem rh.folha não vê os benefícios');
select pg_temp.esperar_erro($c$select importar_beneficios(current_setting('teste.ben_emp')::uuid, 'vt', '2030-10-01', '[{"nome":"X Y","valor":1}]')$c$,
  'não pode importar', 'sem rh.folha não importa');
reset role;
set role anon;
select pg_temp.esperar_erro($c$insert into beneficios_folha (empresa_id, competencia, tipo, nome, valor) values (current_setting('teste.ben_emp')::uuid, '2030-01-01', 'vt', 'XX', 1)$c$,
  'permission denied', 'ninguém grava direto na tabela');
reset role;

-- Excluir o mês.
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(excluir_beneficios(current_setting('teste.ben_emp')::uuid, 'va', '2030-09-01') = 1, 'exclui o auxílio do mês');
reset role;

-- Ajuda de custo no contas a pagar (pela descrição) aparece para os indicadores.
insert into contas_pagar (empresa_id, descricao, valor, vencimento)
values (current_setting('teste.ben_emp')::uuid, 'Ajuda de custo - setembro', 1500, '2030-09-10');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.esperar(
  (select valor = 1500 and mes = '2030-09' from indicadores_ajuda_custo('2030-09-01', '2030-09-30')),
  'ajuda de custo listada por mês');
reset role;

delete from contas_pagar where descricao = 'Ajuda de custo - setembro';
delete from beneficios_folha where competencia in ('2030-08-01', '2030-09-01');
delete from funcionarios where matricula in ('BEN1', 'BEN2', 'BEN3');
