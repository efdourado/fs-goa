# ADR 0001 — Limite de runtime e hospedagem

- Status: aceito para a Etapa 1; decisão de produção pendente
- Data: 2026-08-28

## Contexto

O briefing cita Vercel como possibilidade, não como requisito definitivo. A fundação visual disponível gera um Worker e oferece D1, mas o produto exige contas próprias com nome de usuário e senha. A autenticação do ambiente Sites/ChatGPT não substitui esse requisito.

## Decisão

Usar o runtime atual somente para a fundação e o preview da Etapa 1. Não ativar D1 nem implementar autenticação até escolher, no início da Etapa 2, entre:

- Worker + D1; ou
- Next.js/Vercel + PostgreSQL.

A escolha deve considerar operação, recuperação de conta, compatibilidade da biblioteca de autenticação e custo real dos planos gratuitos.

## Consequências

- a primeira tela pode ser validada sem acoplamento prematuro;
- não existe migração de dados a desfazer;
- a Etapa 2 começa com uma decisão explícita e um pequeno spike técnico;
- a camada visual permanece aproveitável em qualquer alternativa.
