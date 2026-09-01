# Roadmap do Goa

> **O registro vivo de um grupo — clube de cinema, de leitura, de hábitos —
> organizado em rodadas, com análise de verdade das avaliações e de quem indicou
> o quê.** A visão-alvo vem das planilhas que o grupo mantinha na mão
> (`docs/archives/cine/`): o app gera os mesmos resultados com muito menos
> trabalho, sem virar uma planilha no navegador.

## Onde estamos

O **core está fechado**: acervo com identidade entre rodadas, receitas versionadas
(`cine_free / cine_curated / reading_club / reading_daily`), múltiplos tipos de
registro ponta a ponta, motor de análise (ranking ajustado, polarização, surpresa,
viés do indicador) e vitrine gerada automaticamente ao encerrar. Modelo de domínio
em [docs/architecture.md](docs/architecture.md).

## Entregue

- **Fase 0** — página "Como podemos melhorar?", Sobre, footer, link de reunião,
  remoção da própria conta.
- **Fase 1 — fundação relacional** (migrações 0010–0012). Acervo por grupo
  (`catalog_items`), `challenge_items.catalog_item_id` + `recommended_by_user_id`,
  `challenge_items` independente do `entry_type`, `entry_types` com os 4 eixos
  ortogonais, `entries.checkpoint_id` + índices por cardinalidade
  (`once_per_item_day` destrava "dois livros no mesmo dia"),
  `challenges.recipe_key`. Cine Curadoria ponta a ponta (expectativa que trava ao
  avaliar); aba Campos por tipo de registro; duplicação carrega a receita, zera a
  agenda e remapeia o acervo do destino.
- **Análise + vitrine + memória** (migração 0013). `group_by` calculado como série;
  operações `bayesian_average / spread / surprise / indicator_bias` com mínimo de
  amostra; receitas semeiam as métricas certas; `generateShowcase` monta hero +
  KPIs + ranking + perfis + melhores comentários ao encerrar (admin regenera,
  ajusta manchete/resumo, publica); acervo do grupo com histórico de nota de um
  item entre rodadas.
- **Base** — modo escuro (tokens + `prefers-color-scheme` + cookie), bilíngue
  pt-BR/en (`next-intl`), desafio sem data, estrutura editável com o desafio ativo.

## Próximo

- **Cortes dimensionais** — nota por gênero / década / duração / indicador; a
  taxonomia já existe no acervo.
- **Afinidade entre pessoas** — distância média explicável entre notas em itens
  comuns, sempre com o tamanho da amostra à vista; nominal fica no grupo por
  padrão, publicar exige consentimento. Pearson/Spearman e normalização de viés
  ficam para depois.
- **Blocos / semanas** — como visão sobre `occurred_on`/`checkpoint_id` (semana
  planejada × real), sem contaminar a relação pessoa × item × avaliação.
- **Automação** — sorteio de indicações, digests e notificações, enriquecimento
  por catálogos externos. Só quando um caso concreto justificar; nada de IA agora.

## O que evitar

- Transformar tudo em campo genérico ou JSON.
- Usar dia/checkpoint como objeto avaliado.
- Gravar gênero e duração em cada avaliação.
- Exigir comentário para o sistema saber de qual item se trata.
- Duplicar filme/livro em toda rodada sem identidade.
- Publicar afinidade nominal por padrão.
- Recalcular retroativamente uma vitrine já publicada.

## Fora de escopo

App mobile nativo; feed social entre grupos; import direto de `.xlsx` (migração
manual e pontual); editor no-code genérico de domínio.
