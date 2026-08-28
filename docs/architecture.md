# Arquitetura da fundação

## Estado da Etapa 1

A fundação atual usa React 19, TypeScript, Vinext e Vite, gerando uma aplicação compatível com Cloudflare Workers. Node 22 é ferramenta obrigatória de desenvolvimento e build. O banco permanece desativado nesta etapa (`d1: null`) e não existe autenticação fictícia.

Essa escolha permite validar a interface agora sem fingir que decisões de identidade e persistência já estão resolvidas.

## Fatia entregue

```text
app/page.tsx        tela “Hoje” do participante
app/layout.tsx      idioma e metadados sociais
app/globals.css     sistema visual responsivo
public/og.png       imagem social do produto
tests/              smoke tests do HTML renderizado
docs/               roadmap e decisões
```

O conteúdo é demonstrativo e deliberadamente isolado. Nenhuma informação de usuário é guardada em memória do navegador como fonte de verdade.

## Limites de domínio

Quando o backend começar, o código será organizado por capacidade do produto, não por telas genéricas:

```text
features/
  groups/
  challenges/
  entries/
  metrics/
lib/
  auth/
  validation/
  ids/
db/
  schema/
drizzle/
```

Essas pastas só serão criadas quando houver código real para elas.

## Gate antes da Etapa 2

Há duas rotas tecnicamente válidas, mas elas não devem ser misturadas:

1. **Cloudflare Worker + D1:** aproveita integralmente o runtime atual e um banco SQLite gerenciado de baixo custo.
2. **Next.js na Vercel + PostgreSQL:** segue a infraestrutura sugerida no briefing e usa um provedor relacional do Marketplace, como Neon ou Supabase.

A interface já criada é reaproveitável nas duas rotas. Schema, driver, migrações e autenticação só começam depois dessa escolha.

## Regras não negociáveis

- autorização em toda leitura e escrita no servidor;
- IDs aleatórios não substituem autorização;
- senha nunca armazenada diretamente;
- convites armazenam hash do token e possuem expiração/revogação;
- duplicação copia estrutura, nunca registros pessoais;
- campos e métricas usam identificadores estáveis;
- R2/uploads ficam fora do MVP.

## Estratégia de testes

- **Etapa 1:** lint, TypeScript, build e smoke test do HTML;
- **domínio:** testes unitários de regras e métricas;
- **persistência:** integração contra banco local com migrações reais;
- **segurança:** matriz negativa de acesso entre usuários e grupos;
- **fluxos críticos:** navegador apenas para cadastro, convite, registro e encerramento.
