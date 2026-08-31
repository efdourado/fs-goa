# Roadmap do Goa

O MVP está no ar: desafios privados com campos configuráveis, etapas datadas,
métricas e uma vitrine final. Já entraram também **modo escuro** e **interface
bilíngue (pt-BR/en)**. Este documento organiza a evolução para o que o Goa quer
ser:

> **O registro vivo de um grupo — clube de cinema, de leitura, de hábitos —
> organizado em rodadas, com análise de verdade das avaliações e de quem indicou
> o quê.** O app também pode servir como uma _to-do list_ de hábitos, não só como
> desafio fechado.

A visão-alvo vem das planilhas que o grupo manteve na mão antes do app
(`.tmp/*.xlsx`, não versionadas; fonte em `docs/archives/cine/`). A planilha é uma
excelente **especificação do domínio e dos relatórios** — o app deve gerar os
mesmos resultados com muito menos trabalho, **não** virar uma planilha no
navegador.

## A mudança central: separar o que hoje está misturado

Hoje o sistema mistura três coisas diferentes — **o que aconteceu**, **com qual
objeto** e **em qual dia/checkpoint**. O modo `item | daily | free` amarra num
único eixo três propriedades que são independentes. O caminho é separar:

| Conceito | Hoje | Alvo |
|---|---|---|
| Livro, filme, hábito | texto solto (`"Livro atual"`) ou `challenge_item` sem identidade entre rodadas | **`CatalogItem`** — identidade estável no grupo, atributos tipados, taxonomias |
| Gênero, década, carga | não existe / vira texto | **taxonomia** referenciável e multivalorada |
| Duração, ano, páginas | não existe | **atributo tipado** (número + unidade), analisável |
| Filme indicado por alguém nesta edição | `challenge_item` (título + agenda + `metadata` sempre `{}`) | **`RoundItem`** → `CatalogItem` + indicação + posição + bloco/semana |
| Dia / semana / encontro | modo `daily` colapsa o checkpoint numa data, sem FK | **checkpoint explícito** com FK persistida; bloco/semana como camada de agenda |
| 30 páginas lidas / assistiu / concluiu | um registro por participante/dia (`daily`) ou um por item (`item`) | **evento** com `purpose`, alvo opcional, cardinalidade própria |
| Nota, expectativa, comentário | nota presa ao dia (leitura) ou ao item (cine); comentário usado pra "explicar" a relação | **avaliação** ligada ao item, editável/versionada; comentário nunca é obrigatório pro sistema saber o objeto |
| Ranking, painel, compatibilidade | `groupBy` salvo mas ignorado no cálculo; sempre um escalar | **projeção calculada** — nunca fonte de verdade |

### Tipos de registro = 4 propriedades ortogonais

Em vez de `item | daily | free`:

- **`purpose`** — progresso · conclusão · expectativa · avaliação · check-in
- **`targetPolicy`** — alvo obrigatório · opcional · ausente
- **`cardinality`** — uma vez por item · uma por item/dia · repetível
- **`schedulePolicy`** — livre · dentro da rodada · preso a checkpoint
- campos semânticos do formulário

Um registro precisa poder apontar **ao mesmo tempo** para livro + dia + checkpoint.
A escolha não pode continuar sendo "item ou data".

### Teste de aceitação da fundação

> Uma pessoa registra progresso em **dois livros no mesmo dia**, conclui um deles
> e dá uma nota. O sistema produz dois progressos e uma avaliação
> inequivocamente ligada ao livro concluído, **sem exigir comentário
> explicativo**.

## Onde o Goa falha hoje (âncoras)

- Preset de leitura grava "Livro atual" como texto e joga páginas, conclusão, nota
  e comentário no mesmo formulário diário — [lib/goa/domain/fields.ts](lib/goa/domain/fields.ts).
- O banco proíbe `item_id` no modo diário e permite só um registro por
  participante/dia — [db/schema/entries.ts](db/schema/entries.ts).
- O checkpoint recebido pela API vira uma data e a listagem tenta reconstruí-lo por
  coincidência de data, sem FK — [lib/goa/challenges/entries.ts](lib/goa/challenges/entries.ts).
- `challenge_items.metadata` é sempre `{}` na criação e o detalhe nem o retorna —
  [db/schema/challenge-definition.ts](db/schema/challenge-definition.ts),
  [lib/goa/challenges/items.ts](lib/goa/challenges/items.ts),
  [lib/goa/challenges/detail.ts](lib/goa/challenges/detail.ts).
- `groupBy` é salvo e exibido, mas o cálculo o ignora e retorna um único escalar —
  [lib/goa/challenges/results.ts](lib/goa/challenges/results.ts).
- Taxa de conclusão pressupõe "todos os participantes × todos os itens" — erra em
  hábitos pessoais e trilhos opcionais.
- Duplicar um desafio dá novos IDs aos filmes/livros — não há identidade entre
  rodadas — [lib/goa/challenges/copy.ts](lib/goa/challenges/copy.ts).
- Showcase só entende texto, métrica escalar e comentário —
  [db/schema/results.ts](db/schema/results.ts),
  [app/results/[token]/page.tsx](app/results/[token]/page.tsx).

## Modelo recomendado

Mantém `Group` e `Challenge`. Não é reescrever tudo nem renomear o banco.

```
Grupo
├── Acervo
│   └── CatalogItem: filme, livro, hábito…
│       ├── atributos tipados (duração, ano, páginas…)
│       └── taxonomias / tags (gênero, carga…)
└── Rodada (Challenge)
    ├── RoundItem ───────────── CatalogItem
    │   ├── indicado por
    │   ├── posição
    │   ├── bloco / semana
    │   └── atribuições
    ├── Checkpoints / agenda (com exceções: semanas de pausa)
    └── Registros
        ├── participante
        ├── RoundItem (quando aplicável)
        ├── checkpoint (opcional)
        ├── data/hora
        ├── purpose
        └── valores
        └── Avaliação: nota, expectativa, comentário — ligada ao item
```

`challenge_items` evolui para `RoundItem` ganhando referência ao `CatalogItem`. O
mesmo filme reaparece em outra rodada com outra posição/semana/indicador sem
perder identidade. Duração é número+unidade, não entidade. Gênero é referenciável
porque é categoria multivalorada.

## Motor de análise v2

Formatos de saída além de escalar: **série · ranking · distribuição · matriz ·
perfil**.

Cada definição de métrica declara: conjunto de dados · medida semântica ·
agregação · dimensão · filtros · **mínimo de amostra** · versão do algoritmo ·
audiência (pessoal / grupo / pública).

Parâmetros no template e na metodologia do showcase, **nunca enterrados em
código** (a planilha usa, p.ex., mínimo de 4 notas para ranking e peso 4 na média
bayesiana).

Bateria: nota ajustada (bayesiana) · consenso, polarização, desvio · surpresa e
decepção (exigem Expectativas) · **viés do indicador** · nota/ranking de curador e
perfil por pessoa · análise fatiada (gênero, década, duração, carga, atenção,
semana, rodada de indicação) · painel de destaques e "prêmios".

Métricas básicas ao vivo; análises pesadas cacheadas; ao encerrar/publicar tudo
vira **snapshot imutável**.

### Afinidade entre pessoas

- Cinema/leitura: similaridade de notas em itens comuns. Hábitos: similaridade de
  rotina/aderência, não "gosto".
- **Sempre exibir quantos itens foram comparados**; "dados insuficientes" abaixo
  de um limite.
- Não criar pontuação universal de afinidade. Começar com distância média
  explicável entre notas; Pearson/Spearman e normalização de viés depois.
- Resultado nominal fica no grupo por padrão; publicar exige consentimento ou
  anonimização.

## Showcase v2

Opinativo: o sistema gera uma história pronta; o admin só oculta, reordena e
destaca blocos.

Vocabulário de `result_blocks` ampliado: `leaderboard` · `chart` · `matrix` ·
`profile` · `item_grid` · `timeline`, além de hero/resumo/KPIs/comentários/
metodologia. Cada bloco guarda dataset versionado, config visual, privacidade e
snapshot.

Blocos: hero + resumo · KPIs · ranking dos itens · gênero/década/duração ·
consenso e polarização · expectativa × resultado · matriz de afinidade · perfil
dos curadores · linha do tempo · cards e comentários · metodologia e tamanho das
amostras.

## Criação simples (sem reproduzir as 9 abas)

1. Escolher modelo: Cine · Leitura · Hábitos · Customizado.
2. Nome, período opcional, participantes.
3. Colar lista/tabela de itens **ou** escolher itens já no acervo.
4. Completar só os metadados necessários (gênero, duração, autor…).
5. Organizar por drag-and-drop em blocos/semanas; confirmar indicadores.
6. Prévia dos registros, análises e showcase que serão gerados.

Colagem tabular + import CSV resolvem a maior parte. Import direto de `.xlsx` fica
para depois. O template traz a receita completa: tipo de item + atributos,
formulários (expectativa/progresso/avaliação), agenda **relativa**, métricas +
limites de amostra, layout do showcase, regras de privacidade.

Para o participante: "Li hoje" → páginas/minutos; "Terminei" → nota + comentário
opcional; "Assistido" → avaliação. Comentário sempre disponível, nunca necessário.

## Página "Como podemos melhorar?"

Recurso transversal da Fase 0. Acessível pelo footer, configurações e depois de
criar/publicar — sem modal agressivo.

1. Em que parte do Goa você estava?
2. O que estava tentando fazer?
3. Conseguiu? Facilidade de 1 a 5.
4. O que atrapalhou ou está faltando?
5. Impacto: bloqueou / deu trabalho / incômodo pequeno / ideia futura.
6. Como resolve isso hoje: planilha / WhatsApp / Notion / outro app / não resolve.
7. Que mudança faria você voltar mais ou indicar o Goa?
8. Podemos entrar em contato? E-mail opcional, consentimento não pré-marcado.

Pergunta condicional e opcional sobre disposição a pagar **só** depois de uma
experiência de sucesso — nunca obrigatória.

O sistema anexa rota, versão, idioma, tipo de template e papel do usuário —
**nunca** conteúdo de notas, comentários ou registros. Guarda versão do
formulário, categoria e consentimento.

## Fases

| Fase | Entrega | Critério de saída |
|---|---|---|
| **0 — Alinhamento e escuta** | Vocabulário fechado (item, rodada, evento, avaliação, privacidade); página "Como podemos melhorar?"; plano de migração; deletar conta · Sobre · footer · link de reunião | Equipe concorda sobre a abstração central |
| **1 — Fundação relacional** | Acervo por grupo · `RoundItem` + indicação + atribuições · checkpoint explícito com FK · `purpose/targetPolicy/cardinality/schedulePolicy` separados · múltiplos tipos de registro ponta a ponta · UI de reordenar/agrupar | **Cenário dos dois livros no mesmo dia funciona** |
| **2 — Criação rápida e verticais** | Cine, Leitura e Hábitos completos · atributos tipados + taxonomias · colagem em lote · templates versionados · semanas de pausa · trilho paralelo | Gênero/duração cadastrados uma vez e usados nas análises |
| **3 — Motor de análise v2** | Agrupamento real · Bayes, mediana, dispersão, consenso, surpresa, viés · Expectativas · cortes dimensionais | Paridade automatizada com os resultados da planilha de referência |
| **4 — Showcase v2** | Receitas de blocos · rankings, gráficos, matriz · preview privado · curadoria · snapshot | Showcase útil gerado sem configurar métrica na mão |
| **5 — Memória do grupo** | Histórico entre rodadas · rankings acumulados · perfis e afinidade com privacidade | O mesmo item é reconhecido em rodadas diferentes |
| **6 — Automação** | Enriquecimento por catálogos externos · importadores assistidos · **sorteios automatizados** · organização sugerida por IA (tema, expectativa, duração dos filmes…) · digests e notificações | Automação reduz trabalho comprovado nos feedbacks |

A fundação do acervo vem **antes** do motor de análise: gênero, duração,
indicador e histórico dependem dela.

## Decisões a fechar agora

- Acervo e rodadas são filhos irmãos do grupo; `RoundItem` liga os dois.
- Avaliação ligada ao item e disponível durante a rodada; checkpoint é opcional.
- Notificações in-app primeiro (D3 mantida).
- Métricas básicas ao vivo; snapshot definitivo na publicação.
- Poucos templates first-party e versionados antes de abrir um construtor geral.

## O que evitar

- Transformar tudo em campo genérico ou JSON.
- Usar dia/checkpoint como objeto avaliado.
- Gravar gênero e duração em cada avaliação.
- Exigir comentário para descobrir qual livro foi concluído.
- Duplicar livro/filme em toda rodada sem identidade.
- Publicar afinidade nominal por padrão.
- Construir um editor no-code genérico antes de validar Cine, Leitura e Hábitos.
- Recalcular retroativamente um showcase já publicado.

## Entregue

- **Fase 0** — página "Como podemos melhorar?", página Sobre, footer, link de
  reunião no desafio, remoção da própria conta.
- **Fase 1a** — acervo de filmes por grupo (`catalog_items`), identidade do filme
  entre rodadas (`challenge_items.catalog_item_id`), tags de gênero, e
  `recommended_by_user_id` no item — a peça que destrava o viés do indicador.
- **Modo escuro** — tokens claro/escuro, `prefers-color-scheme` + escolha
  explícita por cookie, toggle System/Claro/Escuro.
- **Bilíngue pt-BR/en** — `next-intl`, locale por cookie, sem prefixo de URL.
- **Desafio sem data** — início/fim opcionais, datas passadas, check-in diário sob
  demanda, encerramento manual, atalhos de duração.
- **Estrutura editável com o desafio ativo** — prazo, campos e itens ajustáveis;
  o servidor barra só o que estraga dados; o encerramento congela.

## Fora de escopo por enquanto

- App mobile nativo.
- Descoberta pública / feed social entre grupos.
- Import direto das planilhas `.xlsx` (migração manual e pontual).
- Editor no-code genérico de domínio.
