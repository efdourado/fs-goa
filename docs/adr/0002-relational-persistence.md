# ADR 0002 — Persistência relacional

- Status: direção aceita; tecnologia condicionada ao ADR 0001
- Data: 2026-08-28

## Contexto

Grupos, papéis, desafios, campos, registros e métricas possuem relações, restrições e necessidades de auditoria. Configurações flexíveis não tornam o domínio inteiro documental.

## Decisão

Usar banco relacional e migrações versionadas. A estrutura de campos poderá guardar configurações limitadas em JSON, mas propriedade, autorização, registros e histórico permanecem relacionais.

Drizzle é a opção inicial de acesso e migração enquanto o runtime atual estiver mantido. A decisão será revista se a rota Vercel/PostgreSQL indicar outra ferramenta com benefício concreto.

## Consequências

- integridade e isolamento podem ser impostos também pelo banco;
- métricas consultam campos por identificador estável;
- mudanças de schema passam por migração revisável;
- o banco não é ativado antes de existirem as primeiras tabelas reais.
