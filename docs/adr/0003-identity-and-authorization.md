# ADR 0003 — Identidade, convites e autorização

- Status: requisitos aceitos; biblioteca pendente de spike
- Data: 2026-08-28

## Contexto

O MVP pede nome, nome de usuário e senha, deixando e-mail para recuperação futura. Bibliotecas comuns frequentemente tratam e-mail como obrigatório. Improvisar hash, sessão ou recuperação manualmente aumentaria o risco.

## Decisão

Manter identidade própria do produto e não trocar silenciosamente o requisito por “Entrar com ChatGPT”, Vercel ou outro provedor. Antes da Etapa 3, um spike deve provar:

- cadastro e login por nome de usuário;
- e-mail realmente opcional;
- hash de senha por implementação madura;
- sessão HTTP-only, rotação e revogação;
- compatibilidade com o banco/runtime escolhidos.

Autorização será baseada na associação do usuário ao grupo e verificada em todo caso de uso no servidor. Papéis iniciais: `owner`, `admin` e `participant`.

Convites usarão token aleatório mostrado somente no link. O banco guardará apenas o hash, a expiração, o estado de revogação e os limites de uso.

## Consequências

- identidade de terceiros pode ser adicionada depois, sem ser requisito do MVP;
- a escolha da biblioteca não será feita apenas por popularidade;
- testes negativos entre grupos fazem parte da definição de pronto.
