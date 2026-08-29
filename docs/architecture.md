# Arquitetura

## Visão geral

Aplicação React 19 + TypeScript com Vinext/Vite. A API REST roda no mesmo runtime
da interface; o servidor de produção é um processo Node (`vinext start`). O
PostgreSQL 16+ é a única fonte de verdade. Docker Compose orquestra banco,
migração/seed e aplicação para desenvolvimento e piloto.

```text
navegador ──JSON + cookie HTTP-only──▶ Vinext / API REST ──SQL parametrizado──▶ PostgreSQL
                                        ├── autenticação, CSRF e autorização
                                        ├── grupos, convites e desafios
                                        ├── registros, métricas e resultados
                                        └── auditoria e exportação
```

## Limites de módulo

| Arquivo | Responsabilidade |
| --- | --- |
| `app/GoaApp.tsx` | aplicação cliente responsiva e contrato REST centralizado |
| `app/api/[...path]/route.ts` | roteamento HTTP fino; nenhuma decisão de autorização na interface |
| `lib/auth.ts` | contas, sessões, rate limit e papéis |
| `lib/security.ts` | PBKDF2, tokens, cookies, origem e CSRF |
| `lib/goa-domain.ts` | grupos, convites e criação dos presets |
| `lib/goa-challenges.ts` | campos, registros, métricas, resultados e duplicação |
| `lib/validation.ts` | validação tipada e exportação CSV segura |
| `db/schema.ts` | 20 tabelas, checks, índices parciais e FKs compostas |
| `drizzle/` | única fonte de migrações reproduzíveis |
| `scripts/` | `migrate.mjs` (migrações) e `seed-admin.mjs` (conta de administração) |

## Modelo de domínio

Grupos são duradouros e contêm desafios. A associação do usuário ao grupo define o
papel (`owner`, `admin`, `participant`); uma associação separada ao desafio define
quem envia registros. Cada desafio tem um ou mais tipos de registro, campos
semânticos estáveis e itens (por objeto) ou checkpoints (por dia).

Números e notas são guardados como inteiros escalados. Campos e opções em uso são
arquivados, nunca apagados. Métricas referenciam IDs de campos e são recalculadas
sem modificar os dados de origem. Ao encerrar, blocos de resultado guardam
snapshots da curadoria; a página pública exige um token aleatório cujo banco
armazena apenas o hash.

## Segurança

- senhas nunca são persistidas nem retornadas; PBKDF2-HMAC-SHA256 com 600.000
  iterações e salt individual via Web Crypto;
- nome de usuário é NFKC, minúsculo, restrito e único no PostgreSQL;
- tokens de sessão e convite têm 256 bits; o banco guarda somente SHA-256 base64url;
- cookie `__Host-goa_session` é `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`;
- toda mutação autenticada exige `Origin` exata e token CSRF ligado à sessão;
- toda consulta a recurso privado parte da associação ativa ao grupo — IDs UUID
  não concedem acesso;
- participante só altera o próprio registro; a administração é validada no servidor;
- payload JSON tem limite e campos dinâmicos têm validação estrita;
- CSV neutraliza células que poderiam virar fórmulas;
- métricas usam enums, nunca SQL ou fórmulas arbitrárias;
- duplicação usa allowlist estrutural em transação: desafio, tipos, checkpoints,
  itens, campos, opções e métricas ganham novos IDs; participantes, registros,
  valores, resultados, convites e tokens nunca são copiados;
- auditoria append-only registra correções e transições, sem senha ou token;
- login tem limite persistente por nome de usuário normalizado.

Cobertura automatizada: `tests/security.test.ts`, `tests/validation.test.ts`,
`tests/metrics.test.ts` e `tests/integration/mvp.test.ts` (contas distintas,
convite, CSRF negativo, ocultação de rascunho, isolamento entre grupos, registro
por item e por dia, exportação, encerramento, vitrine e duplicação com
texto-canário).

## Operação

O passo `setup` (`npm run db:setup`) só termina após aplicar `drizzle/` e garantir
a conta de administração; a aplicação depende desse término. O PostgreSQL tem
healthcheck e volume nomeado. `GET /api/health` verifica processo e banco.

`DATABASE_URL`, `APP_ORIGIN` e `ADMIN_PASSWORD` são segredos do runtime e nunca
entram na imagem. O banco Docker local não deve ser exposto à internet.

## Decisões

**Runtime.** React/Vinext/Vite com limite compatível com Cloudflare Workers;
produção roda como processo Node em contêiner. Sem dependência de D1/R2. A
aplicação não sobe sem `DATABASE_URL`.

**Persistência.** PostgreSQL + Drizzle para schema e migrações. Relações privadas,
papéis, histórico e auditoria normalizados; JSONB restrito a metadados e snapshots.
FKs compostas garantem que participante, campo, item e opção pertençam ao mesmo
escopo. Transações cobrem convite, registro, encerramento e duplicação.

**Identidade.** Contas com nome, usuário e senha; e-mail opcional. Sessões e
convites por tokens opacos armazenados só por hash. Autorização sempre a partir da
associação ativa ao grupo; IDs aleatórios reduzem enumeração mas não substituem
autorização. Identidade de terceiros pode ser adicionada depois sem mudar o domínio.

## Fora do MVP

Recuperação de conta por e-mail verificado; transferência explícita de ownership
com confirmação; backup/restauração guiados para administradores do ambiente;
mediana e dispersão nas métricas; reagendamento em lote de itens ao duplicar;
sequência diária e melhor semana para o piloto de leitura; templates entre grupos
com consentimento do autor; upload de fotos e vídeos.

Antes de hospedagem ampla: backups, rotação do segredo do banco e TLS do provedor;
o rate limit por usuário não substitui proteção de borda.
