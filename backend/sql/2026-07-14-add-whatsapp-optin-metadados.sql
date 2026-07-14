-- Migration: prova do consentimento confirmado PELO PRÓPRIO NÚMERO.
--
-- Contexto (14/07/2026): horas depois da WABA ser restaurada, alguém criou um estabelecimento falso
-- com o telefone de uma pessoa aleatória, entrou em Configurações e marcou a caixa de opt-in POR
-- ELA. A vítima recebeu template de lembrete e respondeu que não tinha agenda conosco.
--
-- O consentimento estava gravado com texto, data e IP — uma prova impecável de um aceite que não
-- valia nada, porque NUNCA VERIFICAMOS QUE QUEM MARCA A CAIXA É DONO DO NÚMERO. O opt-in inteiro
-- protegia contra descuido e não contra abuso.
--
-- A correção é inverter a verificação: em vez de mandarmos um código (que exigiria um template de
-- autenticação aprovado na Meta, e que qualquer um com acesso ao aparelho leria), o titular MANDA
-- "AUTORIZO" do WhatsApp dele. Só o dono do número consegue fazer isso.
--
-- `metadados` guarda o wamid dessa mensagem — o identificador que a Meta emitiu. É o que transforma
-- "ele disse que autorizou" em "a Meta registrou que ele autorizou, nesta mensagem, neste
-- instante". É a prova que se leva a um recurso.
USE agendamentos;

ALTER TABLE whatsapp_optins
  ADD COLUMN IF NOT EXISTS metadados TEXT NULL AFTER user_agent;
