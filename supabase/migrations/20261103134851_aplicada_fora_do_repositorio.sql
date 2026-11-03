-- =============================================================================
-- Venner Gestão · Registro de uma migração aplicada fora do repositório
--
-- Em 03/11/2026 às 13:48 (UTC) entrou no banco de produção uma migração com
-- este número que não passou por um pacote. Como ela não existia aqui, o
-- "Publicar banco" parou ("Remote migration versions not found in local
-- migrations directory") e a migração 20261103000021_extrato_repetido (pacote
-- #34, linhas repetidas da conciliação) não foi aplicada.
--
-- Este arquivo só registra o número para o histórico daqui bater com o do
-- banco. Em produção ele não roda de novo (o número já consta como aplicado);
-- nos testes não faz nada. Mudanças no banco: sempre por pacote.
-- =============================================================================

select 1;
