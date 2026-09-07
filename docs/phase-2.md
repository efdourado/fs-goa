# Fase 2 — GOA fácil de usar

Proposta de produto, 2026-09-07. Versão-alvo: **v1.1.0**, depois do gate da
**v1.0.0**. Este documento é um backlog; não declara funcionalidades entregues.

## Direção

Uma pessoa deve entender onde está, o que pode fazer agora e quem verá o que
ela escreve. Buscar a organização contextual do Notion e a clareza das tarefas
do Nubank, preservando o caráter guiado do GOA. Não transformar as quatro
receitas num editor genérico nem adicionar complexidade só para parecer completo.

## Organização proposta

- **Início:** continuar um desafio, registrar hoje, convites pendentes.
- **Meu espaço:** desafios pessoais, acervo e histórico; sem pessoas/papéis.
- **Grupos:** desafios e acervo compartilhados; membros e permissões aqui.
- **Explorar:** desafios encerrados explicitamente publicados na galeria;
  modelos aprovados em uma seção distinta.
- **Conta:** perfil, segurança, privacidade e ações de encerramento.

O desafio abre na tarefa principal: registrar quando ativo, preparar quando
rascunho e ler a retrospectiva quando encerrado. Um botão “Editar desafio” abre
seções contextualizadas: detalhes, itens quando aplicável, cronograma quando
aplicável, formulário, acesso/publicação. Métricas avançadas ficam recolhidas.
Links diretos e o botão voltar preservam contexto e seção.

## Backlog para issues do GitHub

Cada linha é uma issue sugerida, com critério de aceite. Executar na ordem.

| ID / título | Escopo e aceite |
| --- | --- |
| UX-01 — Navegação contextual | Remover Pessoas/papéis de desafios pessoais, inclusive gestão e links diretos antigos. Manter membros em grupos mesmo quando há só um membro: esse grupo ainda aceita convites. Não mostrar itens em hábitos, percentuais sem denominador, nem métricas sem amostra; zero válido continua visível. Ausência de dados não se confunde com erro de carregamento. |
| UX-02 — Padrões de formulário e ações | Componentes comuns para rótulo, ajuda, opcionalidade, erro por campo, resumo de erro, carregamento e sucesso. Uma ação principal por seção; salvar/cancelar no mesmo lugar. Campo inválido recebe foco. Erro preserva o rascunho; botão ocupado impede duplicidade. Mesmas regras no cliente e servidor. |
| UX-03 — Edição fluida do desafio | Editar detalhes em contexto; editor maior para campos, listas e cronograma. Mostrar preview real do formulário antes de ativar. Salvar explicitamente no primeiro ciclo; navegação com alterações não salvas oferece continuar editando ou descartar. Explicar limites de edição em desafios ativos/encerrados. Não criar autosave que concorra com salvar ou perca respostas. |
| UX-04 — Exclusão e recuperação | Diálogo compartilhado acessível, foco contido/restaurado, Escape/cancelar, foco inicial seguro. Separar mover à lixeira (recuperável), desativar e excluir permanentemente. Conta exige senha atual e consequências carregadas; falha no preview bloqueia confirmação e oferece tentar novamente. Preview inclui conteúdo já na lixeira. Sucesso só após confirmação do servidor; falha mantém diálogo e dados. |
| UX-05 — Privacidade compreensível | Mostrar quem vê cada registro antes do envio. Consentimento nominal separado da participação. Erro ao alterar consentimento fica visível. Explicar que textos podem identificar alguém mesmo sem nome. Aviso de privacidade acessível no cadastro e na conta, fiel à retenção e operação reais. |
| DISC-01 — Publicação para descoberta | Migração aditiva com descoberta desligada para todo conteúdo existente. Separar privado, compartilhado por link e listado no Explorar. Prévia exata e consentimento específico para a maior exposição; não inferir da autorização de nomes nem da publicação por link. Para grupos, definir autorização dos participantes antes de listar seus dados/contribuições. |
| DISC-02 — Galeria de desafios encerrados | Cards com título, receita, resumo e dados públicos disponíveis; filtros por receita e busca paginada. Ler exclusivamente projeção/snapshot público aprovado, nunca endpoints de desafio privado. Página vazia orienta sem inventar atividade. Modelos e resultados continuam conceitos diferentes. |
| DISC-03 — Revogação e abuso | Despublicar, retirar da galeria, reabrir, excluir, sair e revogar consentimento removem conteúdo/nomes conforme política inclusive dos cards, busca e caches. Reportar conteúdo e moderação limitada ao material público. Testar visitante anônimo, membro, ex-membro e não membro. Nenhum token de link não listado aparece na galeria. |
| QA-01 — Beta de experiência | Testar as quatro receitas com 3–5 amigos em celular e desktop, teclado, zoom e leitor de tela. Criar → editar → registrar → encerrar → compartilhar → revogar, mais recuperação e exclusão. Corrigir bloqueios e confusões antes da divulgação ampla. |

## Contrato da galeria

“Quem tem o link pode ver” não significa “quero aparecer numa busca pública”.
Não listar automaticamente vitrines atuais, desafios pessoais ou modelos.
A primeira galeria pode oferecer inspiração visual sem copiar nada. “Usar como
base” fica para uma entrega posterior: copiar apenas estrutura permitida, nunca
respostas, nomes, comentários ou consentimentos, e criar um rascunho privado.

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

O diálogo da conta deve dizer “Excluir sua conta permanentemente?” e “Essa ação
não pode ser desfeita”, seguido das consequências reais: espaço pessoal apagado,
destino dos grupos, contribuições que permanecem e publicações retiradas.
Evitar “todos os seus dados serão apagados”, que não corresponde ao código atual.

## Definição de pronto

- Novo usuário completa um primeiro registro sem orientação do desenvolvedor.
- Edição não perde texto em falhas ou navegação acidental.
- Nenhuma seção irrelevante para a receita/escopo; nenhum estado vazio enganoso.
- Fluxos críticos funcionam a 360 px, com teclado, zoom de 200% e nos dois idiomas.
- Testes de isolamento e publicação continuam verdes; novos casos cobrem galeria.
- Registrar no beta conclusão de tarefas, pontos de confusão e erros, sem coletar
  o texto privado dos desafios como telemetria.
- Resultado público e navegação interna revisados visualmente; documentação
  descreve o comportamento entregue, não apenas a intenção.

## Organização no GitHub

Um Project **GOA**, com Backlog → Ready → In progress → Review → Done.
Milestones **v1.0.0 — release gate** e **v1.1.0 — experiência e descoberta**.
Labels sugeridas: `ux`, `privacy`, `bug`, `release`, `accessibility`.
Uma issue por resultado acima, com checklist e PR vinculado. DISC-02 depende de
DISC-01; DISC-03 deve estar pronto antes de lançar a galeria. UX-01–05 podem
avançar sem esperar descoberta. Não criar um ramo permanente “v2”: usar branches
curtas `codex/...`, PRs pequenos e `main` sempre publicável.
