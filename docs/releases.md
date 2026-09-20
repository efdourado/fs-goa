# Releases

Como versionar e lançar o GOA. Não guarda o resultado de revisões antigas: o
estado do produto está em [architecture.md](architecture.md) e no histórico do
Git; o que falta para a Fase 2, em [phase-2.md](phase-2.md).

## Gate antes de v1.0.0

Nenhuma release ou tag foi criada ainda, e `package.json` continua em `0.1.0`.
Antes de anunciar a primeira versão estável:

- [ ] Verificar dependências e alertas de segurança atuais.
- [ ] Confirmar no ambiente de lançamento que **todas** as migrações de
      `drizzle/` estão aplicadas (`npm run db:migrate:prod` é idempotente).
- [ ] Confirmar origem/cookies (`APP_ORIGIN`), segredos e ausência de dados
      privados nos logs (`lib/http.ts` registra rota e mensagem de erros
      inesperados — revisar se pathnames com tokens de convite são redigidos).
- [ ] Definir retenção e testar restauração de backup em ambiente isolado.
- [ ] CI completo verde no SHA final: lint, tipos, unidade, integração, build e
      smoke (`.github/workflows/ci.yml`).
- [ ] Beta com amigos nas receitas e nos fluxos de acesso, edição e exclusão
      (QA-01 em [phase-2.md](phase-2.md)).
- [ ] Revisar o fluxo de exclusão de conta: o preview precisa mostrar as
      consequências antes da senha, e o aviso sobre contribuições preservadas em
      grupos que continuam deve estar claro (ver "Conta" em
      [architecture.md](architecture.md)).
- [ ] Alinhar a versão em `package.json`/lockfile e nas notas, commitadas antes
      da tag.
- [ ] Confirmar qual commit a Vercel está efetivamente servindo.

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
dispara o deploy da Vercel; no de produção o `scripts/deploy.sh` aplica as
migrações pendentes antes do build (ver o README). Trabalhar a Fase 2 em
branches/PRs com previews até estar pronta para produção. Reverter código não
reverte migrações: preferir migrações aditivas compatíveis (por isso a coluna
legada `challenges.results_published_snapshot` continua no schema, sem uso) e
registrar o procedimento de recuperação antes de alterações destrutivas.

## Notas de release (rascunho para o v1.0.0)

GOA v1.0.0 entrega desafios de Cinema, Clube de Leitura, Estante, Hábito, Tables
e Personalizado, bibliotecas de itens, respostas compartilhadas, espaço pessoal e
grupos, registros, vitrine com consentimento nominal, modelos e lixeira. Conteúdo
privado por padrão.

Limitações conhecidas: recuperação de senha por e-mail indisponível; sem galeria
de desafios de usuários (só modelos); descoberta pública planejada para v1.1.0.
Completar este rascunho com SHA, migrações e evidências finais depois do gate.
