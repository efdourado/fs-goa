# Roadmap do Goa

O MVP está no ar: desafios privados com campos configuráveis, etapas datadas,
métricas e uma vitrine final. Este documento organiza a evolução para o que o Goa
quer ser:

> **O registro vivo de um grupo — clube de cinema, de leitura, de hábitos —
> organizado em rodadas, com análise de verdade das avaliações e de quem
> indicou o quê.**

A visão-alvo vem de duas planilhas que o grupo manteve na mão antes do app
(`/.tmp/*.xlsx`, não versionadas):

- **Projeto Cine** — 6 pessoas, 30 filmes, 8 semanas de discussão com 2 pausas.
  Cada filme tem um _indicado por_. A planilha calcula nota ajustada (bayesiana),
  consenso, polarização, surpresa vs. expectativa, **viés do indicador**, nota de
  curador, compatibilidade de gosto par a par e a mesma bateria fatiada por
  gênero / década / duração / carga / semana / rodada de indicação.
- **Cine Dupla** — 2 pessoas, **sem semanas nem prazos**: "anda no ritmo de
  vocês dois". Mesma análise, mais simples.

## Princípios

1. Nada público por padrão. Acesso vem sempre da associação ativa a um grupo.
2. O servidor valida cada operação. A posição visual de um campo nunca é regra.
3. Registros históricos são imutáveis; curadoria e apresentação são editáveis.
4. Uma rodada termina virando memória — nunca uma planilha abandonada.
5. O admin não deve precisar cobrar ninguém na unha.

## Decisões de arquitetura em aberto

Nenhuma frente grande avança antes de resolver estas:

| # | Decisão | Impacto |
|---|---------|---------|
| D1 | Uma **rodada** é filha de um acervo do grupo, ou continua sendo o objeto de topo com o acervo como visão agregada? | Schema inteiro |
| D2 | "Avaliar a qualquer hora" vira o **padrão**, com checkpoints datados como opção (leitura)? | Fluxo do participante, geração de etapas |
| D3 | Notificação: **só in-app** primeiro, ou e-mail/push é obrigatório? | Precisa (ou não) contratar provedor agora |
| D4 | Métricas de análise: calcular **no fechamento** ou **ao vivo**? | Complexidade, engajamento |
| D5 | Galeria de templates v1: **2 modelos no código** ou CRUD de template? | Tamanho da Fase 3 |

## Frentes

### 1. Fundação de dados

Destrava quase todo o resto.

- **Atribuição de indicação** — `challenge_items.recommended_by_user_id`.
  Peça-chave: sem ela não há viés de indicação, nota de curador nem análise por
  curador.
- **Distribuição manual** — o admin arruma os N itens em posições / **blocos**
  (temáticos) / **semanas** (temporais). Hoje só existe `position` e nenhuma UI
  de reordenar de verdade nem camada de agrupamento.
- **Notas desacopladas de "checkpoint datado"** — no modo cine, avaliar qualquer
  item já consumido, a qualquer momento, sem reassistir; o único prazo é o fim da
  rodada. Ver D2.

### 2. Formatos e agenda

- [x] **Desafio sem data** — entregue: início/fim opcionais em par, datas passadas
  aceitas, listas por item sem prazo, check-in diário sob demanda e encerramento
  manual. A agenda só pode ser alterada no rascunho. Atalhos de duração (30/60/90
  dias, 6 meses, 1 ano ou dias avulsos) calculam o término a partir do início.
- **Semanas de pausa** — a agenda passa a ter exceções; é o mecanismo oficial de
  recuperação de quem ficou pra trás.
- **Trilho paralelo** — um item de longa duração (uma série, ex.: Attack on
  Titan) que **não é etapa**, não ocupa posição na ordem e é acompanhado de leve
  (progresso por episódio). `challenge_items.kind = 'parallel'`.

### 3. Templates

- **Template = desafio serializado** — campos + itens + regras + métricas +
  formato de agenda, sem participantes nem datas. Leitura e clube de cinema para
  começar; espaço para mais.
- **Galeria de templates** na navegação do header — ver exemplos preenchidos,
  "usar este modelo" abre o fluxo de criação pré-preenchido. Ver D5.

### 4. Acervo vivo

- **Catálogo permanente por grupo** — todo item + nota de toda rodada rola para
  um acervo do grupo, com ranking, compatibilidade e histórico acumulados entre
  rodadas. É a maior mudança conceitual (ver D1): reposiciona o Goa de "desafios"
  para "a vida do clube, organizada em rodadas".

### 5. Motor de análise

Classe nova de métrica além de `sum / average / count / min / max /
completion_rate`:

- Nota ajustada (bayesiana, puxada para a média global quando há poucas notas).
- Consenso, polarização, desvio.
- Surpresa e decepção (exigem **Expectativas**: nota pré-consumo opcional).
- **Viés do indicador** — nota da própria indicação menos a média dos outros.
- Nota e ranking de curador; perfil por pessoa ("curador equilibrado/leve").
- Compatibilidade de gosto par a par (correlação das notas em itens comuns).
- Análise fatiada (gênero, década, duração, carga, atenção, semana, rodada).
- Painel de destaques e "prêmios" (mais generoso, mais rigoroso, melhor
  previsão, maior viés próprio, dupla mais compatível...).

Ver D4 para o momento do cálculo.

### 6. Logística e básico do site

- **Link de reunião** — `meeting_url` no desafio (ou por checkpoint, para a
  discussão semanal) + botão "entrar agora".
- **Digest do admin** — resumo semanal/diário configurável: quem está em dia,
  quem está atrasado, notas pendentes, próximo prazo. Maior investimento de
  infra (ver D3): hoje não há e-mail nem push. Começa in-app.
- **Deletar conta** — soft-delete + purga; tratar grupos em que a pessoa é dona
  (transferir ou bloquear).
- **Página "Sobre"** — a ideia do app e a trajetória do desenvolvedor.
- **Footer** — Instagram [@efdourado](https://instagram.com/efdourado) e links.

## Fases

Ordem proposta — cada fase entrega algo utilizável de ponta a ponta.

### Fase 0 — Básico, risco baixo, ship rápido

Deletar conta · página Sobre · footer · campo de link de reunião.

### Fase 1 — Indicador + notas soltas

`recommended_by_user_id` · modo "avaliar a qualquer hora" · UI de reordenar e
agrupar itens. **Entrega o caso do PDF Cine Dupla inteiro.**

### Fase 2 — Agenda flexível

~~Desafio sem data~~ *(entregue)* · semanas de pausa · trilho paralelo.

### Fase 3 — Templates

Serializar desafio → template · galeria + navegação no header.

### Fase 4 — Motor de análise

Bateria de métricas de análise · Expectativas · resultado v2 da rodada.

### Fase 5 — Acervo vivo

Rollup do catálogo por grupo · histórico e rankings entre rodadas.

### Fase 6 — Notificações

Digest do admin (in-app primeiro, e-mail depois). Puxa junto a **entrega real de
e-mail** (ex.: Resend), que hoje falta também para a redefinição de senha —
mediada pelo administrador no MVP.

## Melhorias transversais (encaixam em qualquer fase)

- **Bilíngue** — interface em inglês e português (i18n).
- **Modo escuro**.

## Fora de escopo por enquanto

- App mobile nativo.
- Descoberta pública / feed social entre grupos.
- Integração automática com catálogos de streaming (JustWatch etc.).
- Import direto das planilhas `.xlsx` (a migração é manual e pontual).
