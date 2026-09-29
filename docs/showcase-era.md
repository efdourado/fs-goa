# A era da vitrine — GOA que dá vontade de mostrar

Registro de produto de 2026-09-29. Guarda **o que decidimos, o que já virou código e as
ideias que surgiram no caminho**, para a gente não perder nenhuma. O estado do código
continua descrito em [architecture.md](architecture.md) e [api.md](api.md).

## A pergunta que guia esta fase

> O que pode acontecer no GOA que faz alguém querer mostrar para outra pessoa na hora?

Inspiração: o vídeo do Reddit em que um software desenha linhas sobre quem faz um
levantamento terra — verdes quando o movimento está certo, vermelhas quando não. Você
entende **sem ler nada**. O GOA já coleta o material para isso (notas, expectativas,
dias, números); faltava transformar esse material em algo que se *vê*.

Princípios que saíram das conversas:

1. **Uma coisa entendida sem legenda** vale mais que dez telas de configuração.
2. **A diferença entre as pessoas é o conteúdo.** "Vimos o mesmo filme e parece que vimos
   filmes diferentes" é a história — não "vocês viram 12 filmes".
3. **Nada inventado.** Só aparece o que os dados sustentam, sempre dizendo a base ("em 6
   títulos em comum"). Resposta que falta continua faltando — nunca vira zero.
4. **Discordar não é errar.** Cor identifica a pessoa, não julga a nota (o vermelho do
   vídeo de exercício sinaliza erro; aqui é gosto).
5. **Não é o Wrapped do Spotify.** Nada de stories em tela cheia com barrinhas no topo —
   o GOA tem o próprio formato (o fio + o almanaque), que se lê, se rola e se baixa.
6. **O caminho rápido tem que ser bonito**; a configuração completa continua lá para
   quem quiser.

## O que já está no código

| Peça | Onde | O que faz |
|---|---|---|
| **Revelar juntos** | `lib/goa/challenges/reveal.ts`, `app/goa/reveal.tsx` | Nota selada (`until_reveal`) até alguém que já avaliou tocar em Revelar — nem o admin vê antes; métricas e rankings também esperam. Os avatares caem na escala um a um (o mais diferente por último), com nome e nota. Quem está com a tela aberta vê a revelação sozinho (atualiza a cada 4 s). Convite "falta a sua nota". |
| **Criação rápida que já começa** | `app/goa/screens/quick-create.tsx` | "Como as notas devem aparecer?" (revelar juntos / palpite antes / na hora); o desafio já nasce ativo e abre em Hoje. |
| **Quem tem o seu gosto** | `lib/goa/taste.ts`, `app/goa/taste-map.tsx` | Mapa em órbita na página do grupo: você no centro, cada amigo tão perto quanto as notas de vocês, somando todos os desafios do grupo; título em que mais concordam e o de maior distância. |
| **O fio + o almanaque** | `app/goa/story/` | Aba Resultado: o desafio inteiro como um desenho — linhas das notas atravessando os títulos (desafios com nota) ou faixas de dias com sequências (hábitos, leitura, treinos) — e embaixo um almanaque com tudo que os dados contam. Pôster inteiro ou cada cartão baixa em PNG. |
| **Métricas automáticas** | `lib/goa/challenges/auto-metrics.ts` | Todo campo de número ou nota que alguém cria ganha métricas na hora (média, ranking por item e por pessoa, por gênero/ano; total, placar, recorde). São métricas normais — dá para editar ou apagar, e apagada não volta. |
| **Demo pública** | `/demo` | Grupo inventado e rotulado: revelar *Tár*, ler a temporada desenhada, e um mês de leitura de quatro amigos. Termina em "Fazer com o meu grupo". |
| **Seed da vitrine** | `npm run db:seed-showcase [--reset]` | No banco local: "Cineclube de Sexta" com a Temporada 1 encerrada (o fio), a Temporada 2 com uma nota selada esperando a sua, e "30 dias de leitura". |

### Dupla e solo têm o próprio desenho

Duas pessoas não são "72% em sintonia" — a diferença é o que torna a dupla interessante. Para dois:
**a mistura de vocês** (onde se encontraram, o que cada um trouxe para o outro), o que os dois amaram, o
que vai render discussão, para onde cada um pende por gênero e como cada um usa a escala; no desenho, o
espaço entre as duas linhas vira uma fita. Sozinho: **o seu gosto** (a sua escala, as notas máximas, a mais
baixa, o seu instinto de palpite) e, nos hábitos, um calendário no lugar de uma faixa solitária.

### Sem abas de Métricas e Vitrine

As métricas nascem sozinhas e o resultado é o fio + o almanaque, então as abas Métricas e Vitrine saíram
do Gerenciar (a API continua — a nota do Hoje e do acervo lê uma métrica). O download é um botão
"Baixar páginas" ao lado de "Baixar PDF": páginas em retrato (4:5) com capa, o fio e o almanaque.

### O almanaque, cartão por cartão

Desafios com nota: **pódio** (top 3 + lista completa), **terreno comum** (duas pessoas que
quase nunca concordam, mas se encontram num gênero — "da próxima vez, comecem por aí"),
**por gênero**, **por ano de lançamento**, **tempo de tela** (e se os longos valeram as
horas), **diretor/autor favorito** e qualquer propriedade de texto do acervo que se repete,
**os críticos** (mais exigente / mais generoso, notas máximas, o nº 1 de cada um), **quem
concorda com quem**, **expectativa vs realidade**, **o nº 1 de cada um**, **as melhores
frases**.

Desafios por dia: **sequências** (maior e atual), **constância** (% dos dias), **totais**
(páginas, km…), **dia da semana mais forte**, **o melhor dia**, **a volta** (quem parou e
voltou), **recordes pessoais** (treinos: primeira sessão → melhor), **nas palavras deles**.

Regras de honestidade que o código já aplica: um gênero/ano precisa de 2 títulos para
"vencer"; terreno comum só entre pares abaixo da concordância mediana do grupo; pares só
com 3+ títulos em comum; sem expectativa não existe cartão de surpresa.

## Ideias no caminho (backlog, em ordem de aposta)

### 1. Recomendar pelo perfil de afinidade
O usuário já nos diz tudo: nota, gênero, diretor, duração, ano. Hoje isso vira o
almanaque; o próximo passo é **usar para recomendar**.
- **Perfil de gosto por pessoa**: média por gênero/diretor/década/duração, com a base à
  mostra ("drama: 4,6 em 7 filmes").
- **"O que ver juntos"**: para duas (ou N) pessoas, gêneros onde todas gostam
  (min das médias) → sugerir títulos do acervo que ninguém viu, desse gênero. "Ana gosta
  de terror, Caio de aventura, os dois de drama → drama é a escolha segura."
- **Próximo filme do grupo**: fim da temporada → "comecem pela próxima por aqui".
- Cuidado: amostra pequena não vira personalidade. Sempre mostrar em quantos títulos a
  sugestão se apoia.

### 2. A decisão do grupo — "ninguém consegue escolher um filme; 60 segundos"
Cada um abre um link e responde rápido (já vi? quero? estou livre?). A lista curta vai
mudando ao vivo e uma escolha aparece **com o porquê** ("todos querem, ninguém viu, cabe
em 90 min"). Um toque vira a próxima sessão. Combina com a ideia 1.

### 3. Corrida contra o fantasma (hábitos)
Seu mês passado corre na tela como uma linha-fantasma; cada registro de hoje põe a sua
linha à frente ou atrás dela. Usa dados que já existem, sem configuração nova, e se lê
na hora — é o equivalente das linhas verdes/vermelhas para hábitos. Em grupo, os
marcadores de leitura de cada um correndo pelo mesmo livro.

### 4. Um plano que cabe na semana (e se conserta)
Rotina colocada contra o tempo disponível; o dia que transborda aparece; "perdi três
dias" gera um plano de recuperação realista. Exige entradas novas (tempo livre, duração,
prioridade) — por isso vem depois da corrida contra o fantasma.

### 5. "Essa conversa podia ter sido um plano"
Colar uma conversa bagunçada e sair com um desafio pronto (filmes, datas, regras, o que
ainda está em aberto). **Precisa de IA para ler texto** — o usuário já pediu "sem IA"
para a criação rápida, então é uma decisão dele antes de construir.

### 6. Insights e pequenos experimentos
"Você completou 8 de 10 sessões curtas e 2 de 7 longas — que tal 15 min na próxima
semana?" Só com histórico suficiente e linguagem cuidadosa (padrão não é causa).

### Menores, anotadas para não esquecer
- Selo "criada pelo GOA" nas métricas automáticas na aba Métricas (hoje só
  `settings.auto` marca).
- Métricas por propriedade personalizada do acervo (diretor, cozinha…) na aba Métricas —
  o almanaque já agrupa; o `groupBy` ainda só conhece ano/autor/gênero.
- Exportar o fio como vídeo curto (hoje: PNG do pôster e de cada cartão).
- Link público do fio respeitando a privacidade da vitrine (comentários do grupo não
  viram públicos só porque alguém compartilhou).
- Notificação "o grupo revelou" / "falta a sua nota".
- Ligar a revelação ao mapa de gosto ("você e Ana concordam 92% em 6 filmes →").
- Opção "revelar juntos" também no assistente completo (hoje: criação rápida e aba Campos).
- Mapa de gosto também num desafio só, não apenas no grupo.
