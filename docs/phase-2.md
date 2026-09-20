# Fase 2 — GOA fácil de usar

Proposta de produto de 2026-09-07, atualizada em 2026-09-19. Versão-alvo:
**v1.1.0**, depois do gate da **v1.0.0** (ver [releases.md](releases.md)). Este
documento separa o que a proposta já virou código do que ainda é backlog; o que
está entregue é descrito em [architecture.md](architecture.md) e
[api.md](api.md), não aqui.

## Direção

Uma pessoa deve entender onde está, o que pode fazer agora e quem verá o que
ela escreve. Buscar a organização contextual do Notion e a clareza das tarefas
do Nubank, preservando o caráter guiado do GOA. Não transformar as receitas num
editor genérico nem adicionar complexidade só para parecer completo.

## O que já saiu da proposta

| Item | Situação |
| --- | --- |
| UX-01 — Navegação contextual | Entregue. **Meu espaço** é uma página própria (`/personal`) ligada no cabeçalho; desafios pessoais não têm Pessoas/papéis; o botão Voltar sobe sempre para a tela pai, nomeada no botão; links diretos e atualização preservam a tela. |
| UX-02 — Padrões de formulário e ações | Entregue: kit comum de formulário (`Field`, `Toggle`, `SelectableCards`, `Disclosure`, `FormDialog`), campos de 44 px, uma ação principal por seção. |
| UX-03 — Edição fluida do desafio | Em grande parte: abas de gerenciamento por contexto; cronograma, campos e itens editáveis com o desafio ativo (só o que deixaria dados órfãos dá `409`). Falta a prévia real do formulário antes de ativar. |
| UX-04 — Exclusão e recuperação | Entregue: `Dialog`/`ConfirmDialog` acessíveis, lixeira permanente e do usuário, exclusão em duas etapas quando há respostas ou métricas envolvidas. |
| UX-05 — Privacidade compreensível | Entregue: cada tipo de resposta diz quem a verá antes do envio; consentimento nominal separado da participação e revogável na hora. |

## Ainda é backlog

Cada linha é uma issue sugerida, com critério de aceite. DISC-02 depende de
DISC-01; DISC-03 precisa estar pronto antes de lançar a galeria.

| ID / título | Escopo e aceite |
| --- | --- |
| DISC-01 — Publicação para descoberta | Migração aditiva com descoberta desligada para todo conteúdo existente. Separar privado, compartilhado por link e listado no Explorar. Prévia exata e consentimento específico antes de listar. |
| DISC-02 — Galeria de desafios encerrados | Cards com título, receita, resumo e dados públicos disponíveis; filtros por receita e busca paginada. Ler exclusivamente projeção pública aprovada, nunca endpoints privados. |
| DISC-03 — Revogação e abuso | Despublicar, retirar da galeria, reabrir, excluir, sair e revogar consentimento removem conteúdo/nomes conforme a política, inclusive dos cards, da busca e de caches. Reportar conteúdo e moderar. |
| QA-01 — Beta de experiência | Testar as receitas com 3–5 amigos em celular e desktop, teclado, zoom e leitor de tela. Criar → editar → registrar → encerrar → compartilhar → revogar, mais recuperação de erros. |

## Contrato da galeria

“Quem tem o link pode ver” não significa “quero aparecer numa busca pública”.
Não listar automaticamente vitrines atuais, desafios pessoais ou modelos.
A primeira galeria pode oferecer inspiração visual sem copiar nada. “Usar como
base” fica para uma entrega posterior: copiar apenas estrutura permitida, nunca
respostas, nomes, comentários ou consentimentos, e criar um rascunho privado
(a galeria de **modelos** já faz isso para desafios que um `platform_admin` publica).

Uma retirada impede novos acessos no GOA; não prometer apagar screenshots ou
cópias feitas por visitantes. Nomes mascarados também não tornam títulos,
descrições e comentários automaticamente anônimos. A prévia precisa mostrar
todo o conteúdo que vai sair do grupo.

## Padrão visual e de interação

Espaçamento, tipografia, bordas, cores e estados consistentes antes de animações.
Texto e conteúdo reais determinam a hierarquia; propriedades opcionais aparecem
quando úteis, com “Adicionar detalhe” para preenchê-las. Controles só de leitura
devem parecer informação, não um formulário quebrado. Botões destrutivos ficam
afastados das ações frequentes. Respeitar movimento reduzido e não depender de
hover, cor ou ícone sem nome para explicar uma ação.

O diálogo da conta diz “Excluir sua conta permanentemente?” e “Essa ação não
pode ser desfeita”, seguido das consequências reais: espaço pessoal apagado,
destino dos grupos, contribuições que permanecem e publicações retiradas.
Evitar “todos os seus dados serão apagados”, que não corresponde ao código.

## Definição de pronto

- Novo usuário completa um primeiro registro sem orientação do desenvolvedor
  (a tela de boas-vindas do Início existe para isso).
- Edição não perde texto em falhas ou navegação acidental.
- Nenhuma seção irrelevante para a receita/escopo; nenhum estado vazio enganoso.
- Fluxos críticos funcionam a 360 px, com teclado, zoom de 200% e nos três idiomas.
- Testes de isolamento e publicação continuam verdes; novos casos cobrem galeria.
- Registrar no beta conclusão de tarefas, pontos de confusão e erros, sem coletar
  o texto privado dos desafios como telemetria.
- Resultado público e navegação interna revisados visualmente; documentação
  descreve o comportamento entregue, não apenas a intenção.

## Organização no GitHub

Um Project **GOA**, com Backlog → Ready → In progress → Review → Done.
Milestones **v1.0.0 — release gate** e **v1.1.0 — experiência e descoberta**.
Labels sugeridas: `ux`, `privacy`, `bug`, `release`, `accessibility`.
Uma issue por resultado acima, com checklist e PR vinculado. Não criar um ramo
permanente “v2”: usar branches curtas, PRs pequenos e `main` sempre publicável.
