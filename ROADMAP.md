# Roadmap GOA — Versão 1

> **Estado:** tópicos 1–17 implementados em `main`. O gate final (§15–17) e a
> execução dos 23 passos do §16 estão documentados em `docs/v1-acceptance.md`.
> Pendências operacionais: migrações `0027`–`0033` no Neon; beta fechado real.

## 1. Definição do produto

O GOA é um construtor guiado de hábitos, listas e desafios individuais ou em grupo.

O sistema oferece modelos delimitados, permite personalização controlada e impede que o usuário ative estruturas incoerentes. Durante o desafio, organiza registros e acompanhamento; ao final, transforma os dados em uma retrospectiva visual, explicável e memorável.

### Objetivos da V1

- Oferecer quatro modelos confiáveis: Cinema, Clube de Leitura, Estante e Hábito.
- Guiar o usuário na configuração de cada modelo.
- Permitir campos adicionais sem transformar o produto em um editor genérico.
- Impedir configurações que produzam registros ou métricas inválidas.
- Facilitar a criação de listas grandes por JSON.
- Organizar itens por checkpoints, incluindo semanas, dias, sessões ou marcos.
- Produzir métricas compreensíveis a partir dos campos do desafio.
- Entregar uma experiência de encerramento semelhante a um "Wrapped".
- Manter todo conteúdo privado por padrão.
- Permitir publicação opcional, revogável e anônima por padrão.
- Ter segurança e recuperação suficientes antes de receber usuários reais.

### Fora do escopo da V1

- Importar XLSX ou PDF.
- Exportar PDF.
- Consultar streaming automaticamente.
- Integrar e-mail, calendário ou outros serviços.
- Editor livre de fórmulas.
- Inteligência artificial interna.
- Status obrigatório "assistindo" ou "pulado".
- Modelo especial para séries.
- Rodadas automatizadas de indicações.
- Marketplace público de templates.
- Duplicação de resultados públicos.
- Feed social.
- Aplicativo mobile nativo.
- Recomendador "Que filme hoje?".

---

# 2. Vocabulário oficial

Para evitar que documentação e código usem conceitos diferentes:

- **Grupo:** espaço compartilhado e duradouro.
- **Espaço pessoal:** grupo privado especial, pertencente a uma única pessoa.
- **Desafio:** experiência estruturada com participantes e registros.
- **Rodada:** desafio que pode ser ativado e encerrado.
- **Lista:** desafio contínuo, sem encerramento obrigatório.
- **Receita:** modelo controlado que cria a estrutura inicial.
- **Tipo de registro:** uma interação distinta, como expectativa, avaliação, progresso ou check-in.
- **Campo:** valor preenchido dentro de um tipo de registro.
- **Item:** objeto acompanhado, como filme ou livro.
- **Item de catálogo:** identidade permanente do filme/livro no grupo.
- **Checkpoint:** unidade temporal ou organizacional: dia, semana, sessão ou marco.
- **Entrada:** registro feito por uma pessoa.
- **Métrica:** cálculo definido pelo GOA sobre entradas existentes.
- **Resultado:** visualização interna do andamento ou encerramento.
- **Publicação:** snapshot opcional acessível por link externo.
- **Template:** estrutura pública aprovada pela administração da plataforma.

Resultado público e template são conceitos diferentes.

---

# 3. Campos mínimos das quatro receitas

A recomendação é manter poucos campos obrigatórios e oferecer os demais como opções sugeridas.

## 3.1 Cinema

### Catálogo

- Título: obrigatório.
- Ano: opcional.
- Duração em minutos: opcional.
- Gênero principal: opcional.
- Indicado por: opcional.

### Avaliação

- Nota: obrigatória, de 0 a 5, passo 0,5.
- Comentário: opcional, até 500 caracteres.

### Tipo opcional: Expectativa

- Expectativa: nota de 0 a 5, passo 0,5.
- Registrada antes da avaliação.
- Não pode ser alterada depois que a avaliação for enviada.

### Campos editoriais sugeridos, mas não obrigatórios

- ritmo;
- carga emocional;
- atenção exigida;
- onde assistir;
- tema;
- pergunta para debate;
- avisos de conteúdo;
- justificativa da posição.

Esses campos devem usar atributos tipados aprovados, não propriedades JSON arbitrárias.

## 3.2 Clube de Leitura

### Catálogo

- Título: obrigatório.
- Autor: recomendado, mas não obrigatório.
- Total de páginas: opcional.
- Ano: opcional.
- Gênero principal: opcional.
- Indicado por: opcional.

Se o total de páginas não for informado, o GOA mostra páginas acumuladas, mas não percentual do livro.

### Progresso

- Livro: obrigatório.
- Páginas lidas no registro: obrigatório, inteiro maior ou igual a zero.
- Data: automática ou ligada ao checkpoint.

### Conclusão

A existência do registro "Terminei" representa conclusão.

Campos opcionais:

- nota de 0 a 5;
- comentário;
- data de conclusão.

## 3.3 Estante

É uma lista contínua de livros avaliados, sem progresso diário obrigatório.

### Catálogo

- Título: obrigatório.
- Autor: recomendado.
- Ano, páginas e gênero: opcionais.

### Avaliação

- Nota: obrigatória.
- Comentário: opcional.

Não exige datas nem checkpoints.

## 3.4 Hábito

O desafio acompanha um check-in recorrente sem item de catálogo.

### Estrutura mínima

- Nome do hábito: obrigatório.
- Frequência ou período: obrigatório para rodadas; opcional em lista contínua.
- Ação "Registrar hoje": obrigatória.

A existência do check-in representa que houve participação naquele dia.

### Campos opcionais

- observação;
- quantidade;
- duração;
- avaliação do dia;
- humor;
- dificuldade;
- escolha personalizada;
- outros campos tipados.

O wizard deve oferecer presets, por exemplo:

- "Apenas marcar como feito".
- "Registrar quantidade".
- "Registrar duração".
- "Registrar nota".
- "Registrar uma anotação".

Isso evita que todo hábito comece com um formulário vazio e abstrato.

---

# 4. Regras de edição e integridade

## Campos controlados pelo sistema

O administrador não pode alterar livremente:

- receita e versão depois da ativação;
- tipo físico de um campo que já possui respostas;
- cardinalidade;
- identidade e escopo das entradas;
- relação entre desafio, participante, item e checkpoint;
- propósito semântico de avaliação, expectativa, progresso e conclusão;
- escala de um campo se isso invalidar valores existentes.

## Campos controlados pelo administrador

O administrador pode:

- adicionar campos opcionais;
- alterar rótulo e texto de ajuda;
- alterar ordem;
- definir obrigatório ou opcional antes da ativação;
- definir limites de campos numéricos;
- configurar opções;
- criar métricas compatíveis;
- arquivar campos que não possuem registros nem dependências.

## Depois da ativação

- Alterações não destrutivas continuam permitidas.
- Campos com respostas não podem ser apagados.
- Campos usados por métricas não podem ser removidos sem antes resolver a métrica.
- Reduzir limites não pode invalidar respostas existentes.
- Desafios encerrados ficam estruturalmente congelados.
- Correções de respostas permanecem auditadas.

---

# 5. Validador de prontidão

Antes da ativação, o GOA deve apresentar uma revisão completa.

## Erros que bloqueiam ativação

- nenhum participante;
- receita baseada em itens sem itens;
- campo essencial ausente;
- campo obrigatório sem configuração válida;
- avaliação com escala inválida;
- escolha sem opções;
- métrica ligada a campo inexistente;
- operação numérica ligada a campo textual;
- período inválido;
- checkpoint fora do período;
- item ligado a checkpoint de outro desafio;
- ranking impossível devido à configuração;
- estrutura que viola cardinalidade;
- desafio sem maneira válida de registrar participação;
- referências arquivadas ou inconsistentes.

## Alertas que não bloqueiam

- muitos campos obrigatórios;
- muitos itens para o período;
- item sem metadados recomendados;
- ranking com amostra mínima difícil de alcançar;
- expectativa visível antes da avaliação;
- semanas vazias;
- participantes que ainda não aceitaram;
- métrica baseada em campo opcional;
- nenhuma métrica configurada;
- nenhum comentário disponível para a retrospectiva.

O relatório final deve dividir:

- "Corrija antes de ativar".
- "Vale revisar".
- "Tudo pronto".

---

# 6. Construção de listas

## Entrada manual

O usuário pode adicionar itens individualmente, com apenas o título obrigatório.

## Entrada por JSON

O fluxo da V1 deve ser:

1. Colar uma lista JSON.
2. Analisar sem salvar.
3. Mostrar uma prévia.
4. Validar cada linha.
5. Mapear campos conhecidos.
6. Avisar sobre chaves desconhecidas.
7. Detectar itens existentes no catálogo.
8. Permitir corrigir ou ignorar erros.
9. Confirmar a inclusão.
10. Salvar numa única operação consistente.

### Regras

- JSON nunca define schema ou fórmula.
- Chaves desconhecidas não entram automaticamente no banco.
- O usuário pode mapear uma chave para um atributo já definido.
- Duplicidades são apresentadas antes de salvar.
- A operação tem limite de itens.
- Falha parcial não deve criar metade da lista silenciosamente.

## Indicação

Cada item pode:

- apontar para um participante que o recomendou;
- ficar sem indicação;
- manter uma informação textual de origem, como "lista encontrada na internet".

A relação com um participante deve ser preferida quando ele faz parte do grupo. Origem externa deve ser texto separado, sem participante falso.

## Ordenação e sorteio

A V1 oferece:

- manter ordem original;
- ordenar manualmente;
- sortear toda a lista;
- sortear dentro de blocos/checkpoints;
- distribuir sequencialmente entre checkpoints;
- visualizar o resultado antes de confirmar;
- sortear novamente antes de salvar.

Não haverá ainda coleta automatizada de indicações.

---

# 7. Checkpoints e semanas

A decisão recomendada é não criar uma entidade `Week`.

Semana será uma apresentação especializada de checkpoint.

## Responsabilidade do checkpoint

Um checkpoint guarda:

- título;
- tipo de apresentação: dia, semana, sessão ou marco;
- posição;
- data/hora inicial;
- data/hora final;
- descrição opcional.

O checkpoint não guarda respostas.

As respostas continuam em entradas, que podem referenciar simultaneamente:

- participante;
- item;
- checkpoint;
- tipo de registro.

Isso preserva a modelagem atual e evita transformar "semana" no objeto avaliado.

## Organização semanal

Para um desafio organizado em semanas:

- cada item pode ser atribuído a um checkpoint;
- checkpoints não precisam ser consecutivos;
- pausas são permitidas;
- cada semana mostra seus itens;
- duração total é calculada quando os itens possuem duração;
- o sistema identifica semana atual, passada e futura;
- reagendamento não pode deixar registros órfãos.

## Métricas por checkpoint

Adicionar o agrupamento genérico `checkpoint`, em vez de criar regras exclusivas para `week`.

Uma métrica pode ter:

- `groupBy = checkpoint`: valor daquele checkpoint;
- `cumulative = false`: somente respostas daquele checkpoint;
- `cumulative = true`: todas as respostas até aquele checkpoint.

Isso permite mostrar:

- melhor indicação da semana;
- melhor indicação até a semana;
- média por semana;
- média acumulada;
- participação da semana;
- participação acumulada;
- páginas por checkpoint;
- evolução de um hábito.

---

# 8. Visibilidade de registros

A configuração será por tipo de registro.

## Políticas disponíveis

1. **Grupo em tempo real**
   Participantes veem as respostas uns dos outros durante o desafio.

2. **Depois da própria resposta**
   A pessoa vê respostas alheias daquele item/checkpoint somente após enviar a sua.

3. **Depois do encerramento**
   Durante o desafio, apenas o autor e os administradores veem. O grupo vê no resultado.

4. **Somente autor e administradores**
   Não aparece coletivamente nem depois do encerramento, salvo em métrica agregada permitida.

## Padrões sugeridos

| Tipo | Padrão |
|---|---|
| Avaliação | Grupo em tempo real |
| Comentário | Grupo em tempo real |
| Expectativa | Depois da própria resposta |
| Progresso de leitura | Grupo em tempo real |
| Check-in de hábito | Grupo em tempo real |
| Campo pessoal/sensível | Autor e administradores |

A interface deve informar claramente quem verá as respostas antes do primeiro envio.

---

# 9. Métricas oficiais da V1

"Todas as métricas" deve significar todas as operações conhecidas e testadas pelo GOA, não todas automaticamente exibidas em todo desafio.

## Operações básicas

### Contagem

Número de registros válidos.

### Soma

Soma dos valores de um campo numérico.

### Média

média = (soma de x) / n

### Mediana

Valor central da sequência ordenada; em quantidade par, média dos dois valores centrais.

### Mínimo e máximo

Menor e maior valor registrado.

### Conclusão

conclusão = (registros concluídos / registros esperados) × 100

O GOA precisa explicar como calculou o total esperado.

## Métricas de avaliação

### Média ajustada

nota ajustada = (n × média do item + m × média global) / (n + m)

Onde:

- `n`: número de avaliações do item;
- `m`: peso da média global, padrão 4;
- média global: média das avaliações válidas do desafio.

O mínimo recomendado para elegibilidade é 3 avaliações, mas o administrador pode aumentar respeitando o número de participantes.

### Polarização

Desvio-padrão populacional das avaliações. Quanto maior, maior a divergência.

### Consenso

consenso = max(0, 1 − desvio / (amplitude / 2)) × 100

Para escala de 0 a 5, a amplitude é 5.

### Surpresa/decepção

Para respostas pareadas da mesma pessoa e item:

surpresa = avaliação − expectativa

- positivo: superou expectativas;
- negativo: ficou abaixo;
- zero: correspondeu à expectativa.

### Desempenho do indicador

desempenho = média dos itens indicados pela pessoa − média global

O nome "desempenho da indicação" é mais claro para usuários que "viés do indicador".

## Rankings pessoais

Para cada participante:

- quantidade de registros;
- taxa de conclusão;
- média das notas dadas;
- mediana;
- menor e maior nota;
- consistência das notas;
- top itens pessoais;
- itens com menor nota;
- maior surpresa;
- maior decepção;
- desempenho das próprias indicações.

O sistema não precisa transformar tudo em competição. O admin escolhe quais blocos entram no resultado.

---

# 10. Afinidade e perfil de gosto

A confiabilidade depende mais da quantidade de dados compartilhados que do tamanho total do grupo.

## Afinidade V1 — primeira camada

Para itens avaliados por ambas as pessoas:

afinidade direta = 100 × (1 − média das diferenças absolutas / amplitude da escala)

Regras:

- mínimo inicial recomendado: 5 itens em comum;
- sempre mostrar a amostra;
- nunca calcular com apenas um ou dois itens;
- não chamar de compatibilidade pessoal;
- explicar como "semelhança nas avaliações deste desafio".

## Perfil progressivo

Quando houver dados suficientes, o GOA pode construir subperfis: gênero, faixa de ano, duração, autor, outros atributos tipados.

## Afinidade composta

Pesos iniciais: itens compartilhados 50%, gênero 25%, faixa de ano 15%, duração 10%. Peso de dimensão sem amostra é redistribuído. Entra no final da V1.

---

# 11. Wrapped interno

O resultado interno é obrigatório e disponível aos participantes.

## Estrutura mínima

1. Capa com nome, período e participantes.
2. Resumo de conclusão.
3. Total de registros.
4. Métricas de destaque.
5. Ranking geral.
6. Evolução por checkpoint.
7. Top pessoal de cada participante.
8. Perfil de avaliação.
9. Surpresas e decepções.
10. Indicações mais bem avaliadas.
11. Polarização e consenso.
12. Afinidades válidas.
13. Comentários selecionados.
14. Resumo final do grupo.

## Regras

- Valores calculados não podem ser editados.
- O administrador escolhe ordem e visibilidade dos blocos.
- Toda métrica mostra amostra e explicação.
- Métricas sem dados suficientes não aparecem como zero.
- Empates têm regra estável.
- O resultado interno atualiza enquanto o desafio está aberto.
- Ao encerrar, o sistema cria um snapshot.
- Reabrir invalida o snapshot até nova confirmação.

---

# 12. Publicação e consentimento

## Publicação

- Nada público por padrão.
- Somente owner/admin publica.
- Somente desafios encerrados podem ser publicados.
- Publicação gera snapshot.
- Link não é indexado.
- Administrador pode despublicar.
- Administrador pode rotacionar o link.
- Link antigo deixa de funcionar após rotação.
- Publicação não cria template.
- Templates continuam sob controle exclusivo da plataforma.

## Token

Decisão fechada:

- banco guarda apenas o hash;
- token completo é mostrado quando o link é criado;
- se o administrador perder o link, gera outro;
- gerar outro invalida o anterior;
- tokens nunca aparecem em logs ou auditoria.

## Consentimento de nomes

A entrada no desafio deve apresentar claramente que os participantes verão os registros e que o admin poderá publicar uma retrospectiva anônima por padrão. Duas ações distintas:

- aceitar participar do desafio;
- autorizar ou não o nome numa eventual publicação externa (começa desmarcada, revogável).

## Saída do grupo ou desafio

Ao sair: perde acesso a conteúdo privado; nome removido de novas publicações; publicações existentes regeneradas anonimamente; link temporariamente despublicado até a regeneração; métricas agregadas podem permanecer; comentários selecionados permanecem sem autoria.

---

# 13. Lixeira e recuperação

Tudo que puder ser excluído deve usar exclusão recuperável.

## Áreas

- **Minha lixeira:** conteúdo do espaço pessoal, entradas próprias, desafios pessoais, itens pessoais.
- **Lixeira do grupo** (owner/admin): desafios, itens de catálogo, checkpoints, itens do desafio, campos, opções, métricas, publicações.
- **Conta:** fluxo separado — confirmar senha, período de exclusão, sessões revogadas, login apenas para cancelar, publicações anonimizadas, purga após 30 dias.

## Regras gerais

- `deleted_at`: quando foi enviado para a lixeira.
- `purge_after`: quando será removido definitivamente. Prazo padrão: 30 dias.
- restauração mantém IDs e histórico.
- filho não pode ser restaurado sem pai ativo.
- conflito de nome/identidade resolvido antes da restauração.
- excluir um pai deixa os filhos inacessíveis pelo estado do pai.
- restauração e purga são auditadas.
- administrador da plataforma não possui lixeira global de conteúdo.

---

# 14. Administração e auditoria

## O administrador da plataforma pode acessar

- contas e estado operacional; sessões; eventos de autenticação; uso agregado; volume aproximado por conta; limites; erros; feedback completo; indicadores de abuso; datas e identificadores técnicos para suporte.

## Não deve acessar

- títulos de desafios pessoais; descrições e regras; comentários; notas; respostas; conteúdo de catálogo privado; snapshots completos de alterações textuais.

## Auditoria mínima

Registrar: ator; ação; tipo e ID da entidade; grupo/desafio; data; campos alterados; motivo de correção administrativa; dados técnicos estritamente necessários. Evitar cópias integrais de texto em `before/after`.

---

# 15. Fases de execução

## P0 — Fundação segura

1. Formalizar receitas, campos mínimos e invariantes.
2. Corrigir schema agregado do Drizzle.
3. Corrigir deep links e refresh.
4. Implementar preflight.
5. Definir visibilidade por tipo de registro.
6. Voltar token público para hash-only.
7. Limitar conteúdo visível ao administrador da plataforma.
8. Atualizar documentação atual versus legado.

### Gate

Nenhum desafio inválido pode ser ativado, nenhum link interno quebra ao atualizar e nenhum dado se torna público acidentalmente.

## P1 — Construção completa do desafio

Revisar wizard das quatro receitas; presets do Hábito; campos configuráveis; preview do formulário; importação assistida por JSON; indicação e origem da lista; sorteio e ordenação; itens por checkpoint; apresentação semanal; pausas e reagendamento seguro; expectativa no Cinema.

## P1 — Registros e acompanhamento

Política de visibilidade por tipo; conclusão inferida; progresso individual e coletivo; expectativa travada após avaliação; comentários colaborativos no grupo; comentários pessoais no espaço pessoal; edição sem destruir histórico.

## P1 — Métricas e Wrapped

Operações básicas; mediana e consenso; média ajustada e elegibilidade; métricas por checkpoint; modo cumulativo; rankings pessoais; expectativa/surpresa; desempenho de indicação; afinidade direta; Wrapped interno completo; fórmula e amostra em todas as métricas.

## P1 — Privacidade e ciclo de vida

Consentimento ao aceitar desafio; consentimento nominal separado; publicação anônima por padrão; rotação e revogação de links; anonimização ao sair; lixeira pessoal e de grupo; recuperação em até 30 dias; purga automática; fluxo de exclusão de conta; política de privacidade inicial.

## P0 — Qualidade de lançamento

Testes integrados de todas as receitas; testes de permissões e isolamento; testes de visibilidade; testes de lixeira/restauração; testes de publicação e rotação; testes de métricas; testes de deep link; auditoria de acessibilidade; revisão visual mobile/desktop; observabilidade mínima; dados de demonstração realistas; beta fechado; correção dos problemas do beta.

---

# 16. Cenário autossuficiente de aceitação

A V1 precisa passar por este cenário sem utilizar Excel:

1. Criar um grupo com 6 participantes.
2. Criar um desafio Cinema.
3. Definir período com 8 checkpoints semanais e 2 pausas.
4. Colar uma lista JSON com 30 filmes.
5. Revisar erros e duplicidades antes de salvar.
6. Atribuir indicação opcional a cada filme.
7. Distribuir filmes entre os checkpoints.
8. Consultar duração total de cada semana.
9. Adicionar atributos editoriais opcionais.
10. Habilitar expectativa, avaliação e comentário.
11. Configurar visibilidade por tipo.
12. Ativar somente após o preflight.
13. Registrar expectativas e avaliações.
14. Impedir alteração de expectativa após avaliação.
15. Mostrar progresso sem status manual redundante.
16. Calcular métricas gerais, pessoais e por checkpoint.
17. Calcular afinidade apenas para pares com amostra suficiente.
18. Encerrar o desafio.
19. Gerar um Wrapped organizado e compreensível.
20. Publicar anonimamente por link, rotacionar e despublicar.
21. Anonimizar uma pessoa que sair do grupo.
22. Excluir e restaurar um objeto pela lixeira.
23. Abrir todas as telas diretamente por URL.

---

# 17. Definição final de pronto

A V1 estará pronta para divulgação quando:

- os quatro modelos funcionarem de ponta a ponta;
- estruturas inválidas forem bloqueadas antes da ativação;
- listas grandes puderem ser cadastradas rapidamente;
- checkpoints representarem dias, semanas, sessões e marcos;
- expectativa e avaliação estiverem integradas;
- visibilidade for configurável por tipo;
- métricas forem corretas, explicáveis e visualmente úteis;
- o Wrapped for a melhor tela do produto;
- conteúdo privado não for acessível pela administração da plataforma;
- publicação for opcional, revogável e anônima por padrão;
- consentimento nominal for explícito;
- tudo que for excluído possuir recuperação compatível com sua natureza;
- o cenário autossuficiente acima passar integralmente;
- um beta real com amigos não revelar falhas bloqueantes.
