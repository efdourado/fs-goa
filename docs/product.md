# Como o Goa funciona

## Para que serve

Goa é para um grupo pequeno rodar um **desafio privado** — um clube de cinema, 90
dias de leitura, um bolão de hábitos — e sair dele com uma **memória organizada**
em vez de uma planilha abandonada. Cada pessoa registra o que fez; o Goa guarda,
calcula as métricas e, no fim, o grupo publica uma vitrine com os números e os
melhores comentários.

Nada é público por padrão. O acesso vem sempre da associação ativa a um grupo —
saber o link ou o ID de um desafio não dá acesso a nada.

## Contas

- **Cadastro**: nome, nome de usuário e senha. O **e-mail é opcional mas
  recomendado** — é o que permite recuperar o acesso.
- **Login**: nome de usuário **ou** e-mail, mais a senha.
- **Esqueci a senha**: a pessoa pede em "Esqueci a senha" na tela de login. Hoje a
  entrega é **mediada pelo administrador** — o pedido aparece no painel `/admin`,
  aba *Contas*, e o administrador gera um link de uso único (válido por 1 hora) e
  repassa. Ao usar o link, todas as outras sessões da conta são encerradas.
- **Seu perfil** (ícone no topo): por enquanto só o **nome de exibição** e a
  **senha** são editáveis; nome de usuário e e-mail ficam bloqueados. Trocar a
  senha encerra as outras sessões.

## Grupos e papéis

Um **grupo** é duradouro e reúne pessoas entre várias edições de desafios. Quem
cria um grupo vira **owner**. Dentro do grupo:

| Papel | Pode |
| --- | --- |
| **owner** | tudo, incluindo apagar o grupo |
| **admin** | criar/editar/encerrar desafios, convidar, revisar registros, curar a vitrine |
| **participant** | ver os desafios ativos e enviar os próprios registros |

Limites da fase atual (ajustáveis por env): **6 grupos por dono**, **6 desafios por
grupo**. Apagar libera espaço — não some de vez, vai para a lixeira do banco.

## Como adicionar pessoas

1. Owner ou admin abre o grupo e clica **Convidar**.
2. Escolhe validade (dias) e número máximo de usos e gera um **link de convite**
   (também disponível como código curto).
3. Compartilha o link. Quem recebe faz login ou cria a conta e **aceita** o convite
   — entra como `participant`.
4. Um convite expira, pode ser esgotado por número de usos, e cada pessoa só
   consome uma vez (reaceitar é inócuo).

## Desafios

Um desafio vive em três estados: **`draft` → `active` → `closed`**.

- **Rascunho**: só owner/admin veem. Aqui se define o essencial e a estrutura.
- **Ativo**: os participantes selecionados enviam e editam os próprios registros.
- **Encerrado**: os dados de origem congelam; só a curadoria da vitrine continua editável.

O **período é opcional**, sempre em par: início e término são informados juntos ou
ambos ficam vazios. Datas passadas são aceitas de propósito, inclusive para
reconstruir no Goa uma experiência realizada antes do app. A agenda só pode ser
alterada enquanto o desafio está em rascunho. Sem período, o desafio fica **sem
prazo** e permanece ativo até owner/admin encerrá-lo manualmente.

Para não contar dias no calendário, a edição com período traz **atalhos de
duração** (30/60/90 dias, 6 meses, 1 ano ou um número de dias avulso): o término é
calculado a partir do início — ou de hoje, se o início ainda estiver vazio.

**Presets** para começar rápido: *Cine* (um registro por filme) e *90 dias de
leitura* (um checkpoint por dia). Dá para ajustar tudo depois.

**Modo de registro**:
- *por item* — uma lista de objetos (filmes, livros, etapas); um registro ativo por
  item. Sem prazo, funciona como uma lista contínua, disponível até o encerramento
  manual.
- *por dia* — com período, um checkpoint por data entre início e fim; sem prazo,
  cada participante faz um check-in diário sob demanda para hoje ou uma data
  passada, com no máximo um registro por dia.
- *livre* — sem itens; registros soltos.

**Campos** são semânticos e estáveis: texto, número, nota, opção, booleano, data.
Reordenar ou renomear um campo nunca mexe nos dados já enviados; campos em uso são
arquivados, nunca apagados.

## Registros, métricas e vitrine

- Cada participante só edita o **próprio** registro. Owner/admin corrigem qualquer
  registro informando um **motivo**, que fica na auditoria.
- **Métricas** são fórmulas fixas (soma, média, contagem, mínimo, máximo, taxa de
  conclusão) sobre um campo; são recalculadas sem tocar nos dados.
- Ao **encerrar**, o Goa fixa um snapshot dos números. Owner/admin curam a vitrine
  (manchete, resumo, métricas e comentários em destaque) e **publicam**: isso gera
  uma **página pública** em `/results/<token>`. O banco guarda só o hash do token,
  que pode ser rotacionado.
- **Exportar CSV** dos registros a qualquer momento (owner/admin).

## Painel de administração (`/admin`)

Visível só para a conta com `platform_admin` (a criada pelo `db:seed`); qualquer
outra conta recebe `404`. É o painel do desenvolvedor, **só com metadados** —
nunca o conteúdo dos grupos:

- **Uso**: contagem de contas, grupos, desafios, registros; tamanho do banco por tabela.
- **Lixeira**: grupos/desafios/registros apagados; excluir definitivo para liberar espaço.
- **Auditoria**: quem fez o quê, antes/depois, quando; filtro por grupo/entidade.
- **Contas**: cadastro e atividade; **tornar/remover administrador** (não dá para
  mudar a própria conta), desativar/reativar conta, revogar sessões, gerar link de
  redefinição de senha.

## Roadmap

A evolução do Goa — frentes, decisões em aberto e fases — está em
[../ROADMAP.md](../ROADMAP.md).
