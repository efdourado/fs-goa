/**
 * Synthetic content for `db:seed-local` — every name, rating and comment below is invented.
 * Days are offsets from today (negative = in the past), so the seed always looks current.
 */

export const DEMO_PASSWORD = "demo-local-2026";

export const FRIENDS = [
  { key: "vivi", username: "demo_vivi", name: "Vivi" },
  { key: "rafa", username: "demo_rafa", name: "Rafa" },
  { key: "lu", username: "demo_lu", name: "Lu" },
  { key: "theo", username: "demo_theo", name: "Théo" },
] as const;
export type FriendKey = (typeof FRIENDS)[number]["key"];
export type PersonKey = FriendKey | "me";

export const GROUPS = {
  cine: { name: "Cine Dupla", description: "Um filme por noite, dois palpites, uma nota de cada.", members: ["vivi"] as FriendKey[] },
  books: { name: "Clube do Livro de Quinta", description: "Um livro por mês, encontro na última quinta.", members: ["vivi", "rafa", "lu"] as FriendKey[] },
  food: { name: "Rolê de Quinta", description: "Onde comer depois do trabalho — e se vale voltar.", members: ["theo", "lu"] as FriendKey[] },
} as const;

export interface Film { title: string; year: number; runtime: number; genre: string; by: PersonKey }

export const ROUND_01: { title: string; description: string; blocks: Array<{ title: string; description: string; films: Film[] }> } = {
  title: "Cine Dupla · Rodada 01",
  description: "Primeira rodada: títulos escolhidos a quatro mãos, numa ordem que faz um filme conversar com o outro.",
  blocks: [
    {
      title: "Aquecimento", description: "pipoca, risada e adrenalina",
      films: [
        { title: "Gente Grande", year: 2010, runtime: 102, genre: "Comédia", by: "vivi" },
        { title: "John Wick", year: 2014, runtime: 101, genre: "Ação", by: "me" },
        { title: "Projeto Almanaque", year: 2015, runtime: 106, genre: "Ficção científica", by: "me" },
        { title: "Triângulo do Medo", year: 2009, runtime: 99, genre: "Suspense", by: "vivi" },
      ],
    },
    {
      title: "Gente de verdade", description: "cabeça ligada, coração aberto",
      films: [
        { title: "O Caso Collini", year: 2019, runtime: 123, genre: "Drama jurídico", by: "vivi" },
        { title: "The Station Agent", year: 2003, runtime: 89, genre: "Drama", by: "me" },
        { title: "Sussurro do Coração", year: 1995, runtime: 111, genre: "Animação", by: "vivi" },
        { title: "La La Land", year: 2016, runtime: 128, genre: "Musical", by: "me" },
      ],
    },
    {
      title: "Magia & caos", description: "fantasia, multiverso e afeto",
      films: [
        { title: "O Castelo Animado", year: 2004, runtime: 119, genre: "Animação", by: "vivi" },
        { title: "Tudo em Todo Lugar ao Mesmo Tempo", year: 2022, runtime: 139, genre: "Ficção científica", by: "vivi" },
        { title: "Cisne Negro", year: 2010, runtime: 108, genre: "Drama psicológico", by: "me" },
        { title: "Pobres Criaturas", year: 2023, runtime: 141, genre: "Fantasia", by: "vivi" },
      ],
    },
  ],
};

export const ROUND_02: { title: string; description: string; films: Film[] } = {
  title: "Cine Dupla · Rodada 02",
  description: "Segunda rodada: terror de domingo, cinema brasileiro e dois clássicos que a gente fingia ter visto.",
  films: [
    { title: "Trainspotting", year: 1996, runtime: 94, genre: "Drama", by: "me" },
    { title: "Tropa de Elite", year: 2007, runtime: 115, genre: "Ação", by: "vivi" },
    { title: "O Convite", year: 2015, runtime: 100, genre: "Suspense", by: "me" },
    { title: "A Médium", year: 2021, runtime: 131, genre: "Terror", by: "vivi" },
    { title: "Central do Brasil", year: 1998, runtime: 113, genre: "Drama", by: "vivi" },
    { title: "Drive My Car", year: 2021, runtime: 179, genre: "Drama", by: "me" },
    { title: "Bacurau", year: 2019, runtime: 131, genre: "Faroeste", by: "vivi" },
    { title: "Casablanca", year: 1942, runtime: 102, genre: "Romance", by: "me" },
    { title: "O Som ao Redor", year: 2012, runtime: 131, genre: "Drama", by: "vivi" },
    { title: "Uma Batalha Após a Outra", year: 2025, runtime: 170, genre: "Thriller político", by: "me" },
  ],
};

export const ROUND_03: { title: string; description: string; films: Film[] } = {
  title: "Cine Dupla · Rodada 03",
  description: "Rascunho: animação japonesa e ficção científica lenta. Começa depois das férias.",
  films: [
    { title: "A Viagem de Chihiro", year: 2001, runtime: 125, genre: "Animação", by: "vivi" },
    { title: "Blade Runner 2049", year: 2017, runtime: 164, genre: "Ficção científica", by: "me" },
    { title: "Perfect Blue", year: 1997, runtime: 81, genre: "Animação", by: "vivi" },
    { title: "A Chegada", year: 2016, runtime: 116, genre: "Ficção científica", by: "me" },
    { title: "Akira", year: 1988, runtime: 124, genre: "Animação", by: "me" },
    { title: "Solaris", year: 1972, runtime: 167, genre: "Ficção científica", by: "vivi" },
  ],
};

export const FILM_COMMENTS = [
  "'Sabe quando você ri de uma coisa que não devia?'\nFoi isso o filme inteiro.",
  "Coreografia absurda. O começo quase me fez desistir.",
  "Mais divertido do que eu esperava — as regras são frouxas, mas o clima segura.",
  "Desenhamos o esquema num guardanapo e ainda discordamos no fim.",
  "Pesado, lento no começo, e aí a revelação muda tudo.",
  "Curtinho e humano. Virou meu preferido secreto.",
  "Chorei. Não vou comentar mais.",
  "A trilha sozinha já valia a noite.",
  "Bonito demais pra ser tão triste.",
  "Saí dele querendo ligar pra minha mãe.",
  "Longo, mas nenhum minuto sobrando.",
  "Metade de mim amou, a outra metade precisa de um café.",
];

export interface Book { title: string; author: string; year: number; pages: number; genre: string }

export const BOOK_CLUB_NOW: { title: string; books: Book[] } = {
  title: "Clube do Livro · 2º semestre",
  books: [
    { title: "Torto Arado", author: "Itamar Vieira Junior", year: 2019, pages: 264, genre: "Romance" },
    { title: "A Vegetariana", author: "Han Kang", year: 2007, pages: 176, genre: "Romance" },
    { title: "O Avesso da Pele", author: "Jeferson Tenório", year: 2020, pages: 192, genre: "Romance" },
    { title: "Klara e o Sol", author: "Kazuo Ishiguro", year: 2021, pages: 320, genre: "Ficção científica" },
    { title: "Tudo É Rio", author: "Carla Madeira", year: 2014, pages: 210, genre: "Romance" },
  ],
};

export const BOOK_CLUB_DONE: { title: string; books: Book[] } = {
  title: "Clube do Livro · 1º semestre",
  books: [
    { title: "Pequeno Manual Antirracista", author: "Djamila Ribeiro", year: 2019, pages: 136, genre: "Ensaio" },
    { title: "O Conto da Aia", author: "Margaret Atwood", year: 1985, pages: 368, genre: "Distopia" },
    { title: "Cem Anos de Solidão", author: "Gabriel García Márquez", year: 1967, pages: 448, genre: "Romance" },
    { title: "Pachinko", author: "Min Jin Lee", year: 2017, pages: 528, genre: "Romance histórico" },
  ],
};

export const BOOK_COMMENTS = [
  "Terminei de madrugada e fiquei um tempo olhando pro teto.",
  "O começo arrasta, depois não larguei mais.",
  "Queria que tivesse mais cem páginas.",
  "Precisei de pausas — é duro, mas necessário.",
  "A melhor conversa que o clube já teve.",
  "Bonito, mas não me pegou como pegou vocês.",
];

export const PLACES = [
  { title: "Cantina do Zé", comment: "O molho da casa vale a fila." },
  { title: "Taquería La Lupita", comment: "Taco al pastor honesto, atendimento rápido." },
  { title: "Padaria Estrela", comment: "Café coado bom e pão na chapa perfeito." },
  { title: "Izakaya Hachi", comment: "Caro, mas a experiência é outra." },
  { title: "Bar do Ferreira", comment: "Petisco generoso, cerveja gelada, barulhento." },
  { title: "Ramen Kazu", comment: "Caldo fundo, fila longa." },
  { title: "Vegana da Vila", comment: "Me surpreendeu — voltaria sem pensar." },
];

export const MEDITATION_NOTES = [
  "Mente acelerada, mas fiquei.",
  "Primeira vez que os dez minutos passaram rápido.",
  "Chuva lá fora ajudou.",
  "Dormi mal, meditação curta.",
  "Respiração 4-7-8 funcionou.",
  "Fiz no parque, com barulho de criança — valeu mesmo assim.",
];

export const SUGAR_NOTES = [
  "Primeiro dia difícil: bolo no escritório.",
  "Troquei a sobremesa por fruta.",
  "Café sem açúcar já não parece castigo.",
  "Aniversário de alguém — resisti.",
  "Menos sono depois do almoço, juro.",
];

export const EXERCISES = ["Supino reto", "Agachamento livre", "Puxada alta", "Levantamento terra", "Desenvolvimento com halteres", "Remada curvada"];

export const SHELF: Array<Book & { rating: number; comment: string }> = [
  { title: "Grande Sertão: Veredas", author: "João Guimarães Rosa", year: 1956, pages: 624, genre: "Romance", rating: 5, comment: "'Viver é muito perigoso.'\nLi devagar, em voz alta às vezes. Não tem igual." },
  { title: "A Hora da Estrela", author: "Clarice Lispector", year: 1977, pages: 88, genre: "Romance", rating: 4.5, comment: "Curto e devastador." },
  { title: "O Senhor dos Anéis", author: "J. R. R. Tolkien", year: 1954, pages: 1200, genre: "Fantasia", rating: 5, comment: "Releio a cada cinco anos." },
  { title: "1984", author: "George Orwell", year: 1949, pages: 416, genre: "Distopia", rating: 4, comment: "Mais atual a cada ano, infelizmente." },
  { title: "Dom Casmurro", author: "Machado de Assis", year: 1899, pages: 256, genre: "Romance", rating: 4.5, comment: "Traiu. Ou não. Nunca vou saber." },
  { title: "Sapiens", author: "Yuval Noah Harari", year: 2011, pages: 464, genre: "Não ficção", rating: 3.5, comment: "Boas ideias, conclusões apressadas." },
  { title: "O Pequeno Príncipe", author: "Antoine de Saint-Exupéry", year: 1943, pages: 96, genre: "Infantil", rating: 4, comment: "Li adulto e entendi outra coisa." },
  { title: "Ensaio sobre a Cegueira", author: "José Saramago", year: 1995, pages: 312, genre: "Romance", rating: 5, comment: "Precisei parar três vezes. Obra-prima." },
];

/** A tiny deterministic PRNG, so every run of the seed produces the same data. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A 0–5 score in half steps around `center`. */
export function score(next: () => number, center: number, spread = 1): number {
  const raw = center + (next() * 2 - 1) * spread;
  return Math.max(0, Math.min(5, Math.round(raw * 2) / 2));
}
