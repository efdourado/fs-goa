# Goa

Plataforma web de desafios privados e personalizáveis. O participante registra somente o que importa; o sistema organiza e calcula; o administrador revisa e transforma o resultado em memória da experiência do grupo.

> Status: Etapa 1 — fundação técnica e primeira experiência do participante.

## O que já existe

- repositório Git isolado na pasta `fs-goa`;
- base React + TypeScript executada com Vinext;
- primeira tela responsiva do participante, usando o piloto **Cine — Edição 1**;
- metadados sociais próprios e imagem de compartilhamento;
- lint, checagem de tipos, build e smoke tests configurados;
- arquitetura, decisões e roadmap registrados em `docs/`.

A tela atual usa dados demonstrativos. Cadastro, grupos, banco, convites, registros persistentes e métricas pertencem às próximas etapas.

## Pré-requisitos

- Node.js `22.20.0` (ou outra versão compatível com `>=22.13.0`);
- npm `10.9.3`.

Com `nvm` instalado:

```bash
nvm use
npm ci
npm run dev
```

A aplicação local fica disponível em `http://localhost:3000`.

## Verificações

```bash
npm run lint
npm run typecheck
npm test
```

`npm test` também executa o build de produção antes dos smoke tests.

## Documentação

- [Roadmap do MVP](docs/roadmap.md)
- [Arquitetura da fundação](docs/architecture.md)
- [Decisões arquiteturais](docs/adr/)

## Princípios

1. **Participante simples, administração completa.**
2. **Flexível na composição, previsível na execução.**
3. **Privado por padrão e autorizado no servidor.**
4. **Histórico é produto, não efeito colateral.**
5. **Cada etapa termina verificável antes da próxima começar.**
