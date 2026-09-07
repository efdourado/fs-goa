# Releases e revisão da V1

Revisão em 2026-09-07 do commit local `552e27f`. Avaliação de código e testes,
não auditoria completa de segurança nem confirmação do ambiente de produção.

## Parecer

A implementação da V1 está avançada, mas **a publicação estável ainda tem gates
abertos**. Preservar a referência atual; concluir a revisão e o beta antes de
anunciar v1.0.0. Nenhuma release/tag foi criada nesta revisão.

## Achados concretos

| Prioridade | Evidência | Próxima ação |
| --- | --- | --- |
| Gate | Migração `0035` e `lib/goa/challenges/results.ts` persistem token completo para reapresentar links. README, arquitetura e roadmap ainda diziam hash-only. | Documentação corrigida nesta revisão. Revisar conscientemente a exposição dos links em banco/backups e o acesso autorizado; não tratar isso como prova de vazamento público. |
| Gate | `lib/http.ts` registra pathname completo e mensagem de exceção em erros inesperados. Pathnames podem conter tokens de convites; erros de banco podem carregar dados. | Redigir tokens/parâmetros e mensagens sensíveis dos logs; testar a redação e revisar logs da hospedagem. |
| Gate | `account.tsx` ignora falha no preview e permite exclusão com senha mesmo sem mostrar consequências. `accountDeletionPreview` omite grupos na lixeira, mas `deleteOwnAccount` os processa. | Preview completo, estado de erro/retry e confirmação impedida até carregar; diálogo acessível. Manter checagens e senha no servidor. |
| Gate | Exclusão remove identidade da conta, mas preserva contribuições em grupos sobreviventes. Texto livre pode continuar identificando pessoas. Não foi localizado aviso dedicado cobrindo retenção, backups e contato. | Inventariar dados remanescentes, definir tratamento/retencão e publicar aviso fiel. “Sobre” e comentários internos não substituem essa explicação. Não prometer anonimização absoluta. |
| Correção | Nova senha e confirmação usam `minLength={8}`; servidor exige 10 (`lib/security.ts`). | Unificar regra e ajuda visual. |
| Correção | Alteração de consentimento em `account.tsx` captura erro sem mensagem local. | Mostrar falha e permitir nova tentativa sem indicar sucesso. |
| Fase 2 | Gestão em `admin.tsx` inclui aba `participants` para espaço pessoal; wizard já a omite. | Regra contextual única, cobrindo navegação e URL direta. |
| Operação | Último CI retornado pelo GitHub: sucesso em `323867c`, anterior ao HEAD local. Não há releases retornadas nem tags locais. `package.json` ainda está em `0.1.0`. | Rodar CI no commit exato escolhido para release; conferir deploy e migrações nesse mesmo ponto. |

## Verificação desta revisão

- Lint, TypeScript e suíte unitária: passaram (17 arquivos de teste reportados
  pelo runner atual; não comparar essa contagem com asserts dos relatos antigos).
- Integração: **89/89 passaram**, incluindo permissões e publicação.
- Build padrão (Turbopack): bloqueado pelo ambiente ao criar processo/abrir
  porta (`Operation not permitted`), inclusive na tentativa com escalonamento.
  Isso não comprova falha de código; o build padrão continua pendente no CI.
- Build alternativo `next build --webpack`: passou; os **2 testes de HTML
  renderizado** passaram sobre esse build. Não altera o comando padrão do projeto.
- Testes integrados usam exclusivamente banco local `goa_test`, com migrações.
- Neon, restauração de backup, configurações Vercel, análise de dependências e
  avaliação visual em navegador não foram verificados nesta revisão.
- `docs/v1-acceptance.md` é histórico: contagens e estágios do seed ali não devem
  ser tratados como status atual. O README já descreve os quatro cenários do seed.

## Gate antes de v1.0.0

- [ ] Resolver e testar os achados marcados Gate acima.
- [ ] Verificar dependências e alertas de segurança atuais.
- [ ] Confirmar migrações até `0035` no ambiente de lançamento.
- [ ] Confirmar origem/cookies, segredos e ausência de dados privados nos logs.
- [ ] Definir retenção e testar restauração de backup em ambiente isolado.
- [ ] CI completo verde no SHA final: lint, tipos, unidade, integração, build e smoke.
- [ ] Beta com amigos nas quatro receitas e fluxos de acesso, edição e exclusão.
- [ ] Alinhar versão em `package.json`/lockfile e notas, commitadas antes da tag.
- [ ] Confirmar qual commit está efetivamente servido pela Vercel.

## Como nomear

| Nome | Uso no GOA |
| --- | --- |
| `v1.0.0-rc.1` | Candidato funcional ainda em validação; marcar como pre-release. |
| `v1.0.0` | Primeira base estável após o gate. |
| `v1.0.1` | Correções pequenas compatíveis. |
| `v1.1.0` | Fase 2: organização/edição melhores e descoberta opt-in. |
| `v2.0.0` | Reservar para mudanças incompatíveis relevantes; “fase 2” não obriga major 2. |

Convenção inspirada em [Semantic Versioning](https://semver.org/). Para o GOA,
registrar explicitamente impactos em API, dados e fluxos existentes; não confundir
uma mudança visual grande com quebra de compatibilidade.

## O que escolher no GitHub

Um **commit** é uma fotografia completa do projeto. Uma **tag** dá um nome fixo
a essa fotografia. Uma **Release** apresenta essa tag com notas de lançamento.
Você escolhe um commit final aprovado, não uma lista de commits separados: ele
já contém as mudanças acumuladas até ali.

1. Resolver o gate via PRs e escolher o SHA final com CI verde.
2. Criar a tag `v1.0.0` nesse SHA exato; não apontar cegamente para um `main` que
   pode ter avançado. Não mover/reutilizar tags publicadas.
3. Em GitHub → Releases → Draft a new release, escolher a tag existente.
4. Título `GOA v1.0.0`; notas com funcionalidades, limitações conhecidas,
   migrações e validação. Salvar draft e publicar quando o ambiente estiver pronto.
5. Continuar desenvolvimento para `v1.1.0`; a tag da V1 continua preservada.

[Documentação de releases do GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).

Uma release do GitHub **não congela o site**. Neste projeto, push em `main`
dispara deploy da Vercel segundo o README; migração é uma operação separada.
Trabalhar a Fase 2 em branches/PRs com previews até estar pronta para produção.
Reverter código não reverte migrações: preferir migrações aditivas compatíveis e
registrar o procedimento de recuperação antes de alterações destrutivas.

## Notas de release propostas (rascunho, não publicar como validação)

GOA v1.0.0 entrega desafios de Cinema, Clube de Leitura, Estante e Hábito,
espaço pessoal e grupos, registros, retrospectivas, compartilhamento por link,
consentimento nominal e lixeira. Conteúdo privado por padrão.

Limitações conhecidas: recuperação de senha por e-mail indisponível; sem galeria
de desafios de usuários; melhorias de edição e navegação planejadas para v1.1.0.
Completar este rascunho com SHA, migrações e evidências finais depois do gate.
