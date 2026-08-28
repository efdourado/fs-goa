# Roadmap do MVP

O desenvolvimento é sequencial. Uma etapa só começa quando os critérios da anterior estiverem atendidos.

## 1. Fundação técnica — concluída

**Objetivo:** corrigir a raiz do Git, criar uma base executável e materializar a experiência mais importante do produto.

Entregas:

- Git restrito a `fs-goa`;
- stack de interface, scripts e versão do Node definidos;
- tela “Hoje” do participante com dados demonstrativos;
- documentação de arquitetura e limites do MVP;
- lint, tipos, build e smoke tests.

## 2. Domínio e persistência

**Objetivo:** modelar usuários, grupos, associações, papéis, convites, desafios e participantes.

Critérios de saída:

- decisão de hospedagem/banco fechada;
- esquema relacional versionado por migrações;
- identificadores públicos não enumeráveis;
- regras centrais cobertas por testes unitários e de integração.

## 3. Autenticação e autorização

**Objetivo:** cadastro, login, logout, sessões e proteção no servidor.

Critérios de saída:

- senha armazenada somente por hash produzido por biblioteca madura;
- nome de usuário normalizado e único;
- matriz de autorização testada entre grupos diferentes;
- nenhuma decisão de segurança depende apenas da interface.

## 4. Grupos privados e convites

**Objetivo:** criar grupos duradouros, membros e convites por link.

Critérios de saída:

- papéis `owner`, `admin` e `participant` aplicados no servidor;
- convite aleatório, expirável, revogável e de uso controlado;
- acesso cruzado entre grupos negado e testado.

## 5. Criação de desafios

**Objetivo:** configurar título, descrição, regras, datas, estado e participantes.

Critérios de saída:

- fluxo administrativo mínimo responsivo;
- estados `draft`, `active`, `closed` com transições válidas;
- participante vê apenas desafios dos grupos aos quais pertence.

## 6. Campos configuráveis

**Objetivo:** permitir campos de texto, número, nota, opção, booleano e data.

Critérios de saída:

- cada campo possui identificador semântico estável;
- alterações não corrompem registros históricos;
- validações são executadas no servidor.

## 7. Registro do participante

**Objetivo:** transformar a tela demonstrativa da Etapa 1 em um fluxo persistente.

Critérios de saída:

- formulário gerado pelos campos do desafio;
- criação e edição autorizadas;
- experiência mobile com alvos de toque e mensagens de erro acessíveis.

## 8. Administração e revisão

**Objetivo:** listar, filtrar, inspecionar e corrigir registros.

Critérios de saída:

- alterações administrativas auditáveis;
- inconsistências visíveis sem expor controles ao participante;
- dados exportáveis em formato simples para segurança operacional.

## 9. Métricas básicas

**Objetivo:** soma, média, contagem, mínimo, máximo e taxa de conclusão.

Critérios de saída:

- métricas referenciam IDs de campos, nunca posição visual;
- cálculos determinísticos com casos extremos testados;
- recálculo não modifica os registros de origem.

## 10. Acompanhamento e encerramento

**Objetivo:** mostrar progresso durante o desafio e criar a vitrine histórica final.

Critérios de saída:

- administrador seleciona métricas e comentários em destaque;
- desafio encerrado preserva sua leitura histórica;
- resultado funciona bem em celular e link compartilhado.

## 11. Duplicação segura

**Objetivo:** copiar a estrutura de um desafio sem transportar dados pessoais.

Critérios de saída:

- regras, campos e configurações são copiados;
- registros, avaliações e comentários não são copiados;
- testes provam a ausência de vazamento entre edição original e cópia.

## 12. Pilotos e publicação

**Objetivo:** validar o MVP com “90 dias de leitura” e “Cine — 30 filmes”.

Critérios de saída:

- revisão de segurança, acessibilidade e responsividade;
- ambiente publicado com migrações reproduzíveis;
- feedback dos dois pilotos convertido em backlog, sem ampliar o MVP automaticamente.
