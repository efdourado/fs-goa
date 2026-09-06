import type { DemoRole } from "../runtime";

/**
 * Twelve real films, six weeks, two per week. Every opinion below is invented for
 * the demo — the ratings matrix is hand-tuned to exercise the analysis: a couple
 * of near-unanimous films, a couple of polarising ones, expectation gaps in both
 * directions (surprise and disappointment), and one recommender whose picks land
 * softer than the group average.
 */

export interface DemoFilm {
  title: string;
  year: number;
  mainGenre: string;
  runtimeMinutes: number;
  /** Which demo account added it to the list. */
  recommender: DemoRole;
  /** 1-based week (1..6); two films per week. */
  week: number;
}

export interface DemoOpinion {
  /** Pre-watch rating, 0–5 in 0.5 steps. */
  expectation: number;
  /** Post-watch rating, 0–5 in 0.5 steps. */
  rating: number;
  comment?: string;
}

export const FILMS: DemoFilm[] = [
  { title: "Parasita", year: 2019, mainGenre: "Suspense", runtimeMinutes: 132, recommender: "owner", week: 1 },
  { title: "Cidade de Deus", year: 2002, mainGenre: "Drama", runtimeMinutes: 130, recommender: "admin", week: 1 },
  { title: "A Chegada", year: 2016, mainGenre: "Ficção científica", runtimeMinutes: 116, recommender: "participant", week: 2 },
  { title: "Bacurau", year: 2019, mainGenre: "Suspense", runtimeMinutes: 132, recommender: "owner", week: 2 },
  { title: "A Viagem de Chihiro", year: 2001, mainGenre: "Animação", runtimeMinutes: 125, recommender: "admin", week: 3 },
  { title: "Whiplash", year: 2014, mainGenre: "Drama", runtimeMinutes: 106, recommender: "participant", week: 3 },
  { title: "Corra!", year: 2017, mainGenre: "Terror", runtimeMinutes: 104, recommender: "owner", week: 4 },
  { title: "Que Horas Ela Volta?", year: 2015, mainGenre: "Drama", runtimeMinutes: 112, recommender: "admin", week: 4 },
  { title: "Mad Max: Estrada da Fúria", year: 2015, mainGenre: "Ação", runtimeMinutes: 120, recommender: "participant", week: 5 },
  { title: "O Som ao Redor", year: 2012, mainGenre: "Drama", runtimeMinutes: 131, recommender: "owner", week: 5 },
  { title: "Ex Machina: Instinto Artificial", year: 2014, mainGenre: "Ficção científica", runtimeMinutes: 108, recommender: "admin", week: 6 },
  { title: "Aquarius", year: 2016, mainGenre: "Drama", runtimeMinutes: 146, recommender: "participant", week: 6 },
];

/**
 * `OPINIONS[filmIndex][role]` — one pre/post pair per person per film (36 of each).
 * Kept deliberately uneven so the ranking, polarisation and surprise metrics all
 * have something to show.
 */
export const OPINIONS: Array<Record<DemoRole, DemoOpinion>> = [
  // 0 — Parasita: near-unanimous high, small positive surprise
  {
    owner: { expectation: 4.5, rating: 5, comment: "A virada no meio da casa é das melhores que já vi no cinema." },
    admin: { expectation: 4, rating: 5, comment: "Esperava gostar, não esperava sair pensando nisso a semana toda." },
    participant: { expectation: 4.5, rating: 4.5 },
  },
  // 1 — Cidade de Deus: high, slight disappointment for one
  {
    owner: { expectation: 5, rating: 4.5, comment: "Continua impecável, só cansa um pouco no último ato." },
    admin: { expectation: 4.5, rating: 5, comment: "A montagem é uma aula." },
    participant: { expectation: 4, rating: 4 },
  },
  // 2 — A Chegada: divisive on pacing
  {
    owner: { expectation: 4, rating: 4.5, comment: "A estrutura do roteiro me pegou de surpresa." },
    admin: { expectation: 4, rating: 3, comment: "Bonito, mas lento demais pro meu gosto." },
    participant: { expectation: 3.5, rating: 4.5, comment: "Chorei no fim, não vou mentir." },
  },
  // 3 — Bacurau: polarising
  {
    owner: { expectation: 4, rating: 4.5, comment: "Gênero puro, do jeito que eu gosto." },
    admin: { expectation: 3.5, rating: 2.5, comment: "A mudança de tom no meio não funcionou pra mim." },
    participant: { expectation: 3, rating: 4 },
  },
  // 4 — Chihiro: unanimous warmth
  {
    owner: { expectation: 4, rating: 4.5 },
    admin: { expectation: 4.5, rating: 5, comment: "Assisto de novo todo ano e sempre acho algo novo." },
    participant: { expectation: 3.5, rating: 4.5, comment: "Não esperava me envolver tanto com uma animação." },
  },
  // 5 — Whiplash: big positive surprise for the participant
  {
    owner: { expectation: 4, rating: 4 },
    admin: { expectation: 3.5, rating: 4 },
    participant: { expectation: 2.5, rating: 5, comment: "Entrei sem expectativa e saí com o coração a mil." },
  },
  // 6 — Corra!: the most polarising film of the round
  {
    owner: { expectation: 4, rating: 5, comment: "Terror com ideia na cabeça é raro. Esse acerta tudo." },
    admin: { expectation: 3, rating: 2.5, comment: "Sustos não me pegam e a sátira ficou óbvia." },
    participant: { expectation: 3.5, rating: 4 },
  },
  // 7 — Que Horas Ela Volta?: quiet consensus
  {
    owner: { expectation: 3.5, rating: 4 },
    admin: { expectation: 4, rating: 4.5, comment: "A cena da piscina vale o filme inteiro." },
    participant: { expectation: 3.5, rating: 4 },
  },
  // 8 — Mad Max: the owner bounces off it hard
  {
    owner: { expectation: 3, rating: 2, comment: "Barulho e poeira por duas horas. Não é pra mim." },
    admin: { expectation: 4.5, rating: 5, comment: "Cada plano é um pôster. Perfeito." },
    participant: { expectation: 4, rating: 4.5 },
  },
  // 9 — O Som ao Redor: slow burn, divides
  {
    owner: { expectation: 3.5, rating: 4.5, comment: "O desconforto é o ponto, e ele constrói isso muito bem." },
    admin: { expectation: 3, rating: 3 },
    participant: { expectation: 3, rating: 2.5, comment: "Admiro mais do que gostei." },
  },
  // 10 — Ex Machina: solid, small letdown for the sci-fi fan
  {
    owner: { expectation: 4, rating: 4 },
    admin: { expectation: 3.5, rating: 4 },
    participant: { expectation: 4.5, rating: 3.5, comment: "O terceiro ato entrega menos do que promete." },
  },
  // 11 — Aquarius: the participant's pick lands soft with the others
  {
    owner: { expectation: 3.5, rating: 3.5 },
    admin: { expectation: 3.5, rating: 3, comment: "Sônia Braga sustenta um filme que se arrasta." },
    participant: { expectation: 4.5, rating: 5, comment: "Um dos melhores retratos de resistência do cinema brasileiro." },
  },
];

export const CINEMA_TITLE = "Cine clube GOA — safra de demonstração";
export const CINEMA_HEADLINE = "Seis semanas, doze filmes, três gostos que quase nunca batem";
export const CINEMA_SUMMARY =
  "Uma rodada fechada do cine clube, com expectativa antes de cada sessão e "
  + "avaliação depois. Serve para ver o Wrapped, os rankings e a afinidade com "
  + "dados de verdade — todas as opiniões são fictícias.";
