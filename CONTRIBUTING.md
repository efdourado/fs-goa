# Contribuindo com o Goa

O Goa é mantido por **Eduardo Dourado**. Colaborações de amigos e ajudantes do
projeto são bem-vindas — normalmente em telas ou features combinadas antes.

## Licença das contribuições

Ao enviar um Pull Request (ou qualquer código, texto, arte ou ideia) para este
repositório, você concorda que:

1. Sua contribuição é licenciada sob a
   [Functional Source License 1.1 (FSL-1.1-ALv2)](LICENSE.md), a mesma do projeto;
2. Você concede a Eduardo Dourado uma licença perpétua, mundial, não exclusiva,
   isenta de royalties e **sublicenciável** para usar, modificar, distribuir e
   **relicenciar** sua contribuição como parte do Goa — inclusive sob outra
   licença futura que o projeto venha a adotar;
3. Você tem o direito de conceder essa licença (o código é seu ou você tem
   permissão para contribuí-lo), e ele não viola direitos de terceiros.

Você continua sendo autor da sua contribuição e mantém o direito de usá-la em
outros lugares. O que muda é que o Goa como um todo — a direção do projeto e o
licenciamento — segue sob responsabilidade do mantenedor.

## Antes de um PR

- `npm run lint && npm run typecheck && npm test` precisam passar.
- Alterou o schema? Gere a migração (`npm run db:generate`) e teste em `goa_test`.
- Texto de interface novo entra em `messages/pt-BR.json` **e** `messages/en.json`.
- Commits: uma linha, sem corpo, sem trailer de co-autoria — igual ao histórico.
