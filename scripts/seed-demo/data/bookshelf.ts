import type { Role } from "../scenarios/shared";

/**
 * A standing "ten books that stuck with us" shelf — no period, just ratings.
 * The three tastes are drawn far apart on purpose: the owner leans literary and
 * bounces off genre; the admin lives in sci-fi/fantasy; the participant rates
 * warmly across the board. That spread is what the taste-profile result shows.
 */

export interface DemoShelfBook {
  title: string;
  author: string;
  year: number;
  pageCount: number;
  mainGenre: string;
  recommender: Role;
}

export const SHELF: DemoShelfBook[] = [
  { title: "1984", author: "George Orwell", year: 1949, pageCount: 416, mainGenre: "Distopia", recommender: "admin" },
  { title: "Orgulho e Preconceito", author: "Jane Austen", year: 1813, pageCount: 424, mainGenre: "Romance", recommender: "owner" },
  { title: "O Sol é para Todos", author: "Harper Lee", year: 1960, pageCount: 320, mainGenre: "Drama", recommender: "owner" },
  { title: "Crime e Castigo", author: "Fiódor Dostoiévski", year: 1866, pageCount: 592, mainGenre: "Drama", recommender: "owner" },
  { title: "O Pequeno Príncipe", author: "Antoine de Saint-Exupéry", year: 1943, pageCount: 96, mainGenre: "Fábula", recommender: "participant" },
  { title: "Duna", author: "Frank Herbert", year: 1965, pageCount: 680, mainGenre: "Ficção científica", recommender: "admin" },
  { title: "A Revolução dos Bichos", author: "George Orwell", year: 1945, pageCount: 152, mainGenre: "Sátira", recommender: "admin" },
  { title: "Ensaio sobre a Cegueira", author: "José Saramago", year: 1995, pageCount: 320, mainGenre: "Distopia", recommender: "owner" },
  { title: "O Nome do Vento", author: "Patrick Rothfuss", year: 2007, pageCount: 656, mainGenre: "Fantasia", recommender: "admin" },
  { title: "Um Defeito de Cor", author: "Ana Maria Gonçalves", year: 2006, pageCount: 952, mainGenre: "Histórico", recommender: "participant" },
];

interface ShelfOpinion {
  rating: number;
  comment?: string;
}

/** `RATINGS[bookIndex][role]`. */
export const RATINGS: Array<Record<Role, ShelfOpinion>> = [
  // 1984
  { owner: { rating: 4 }, admin: { rating: 5, comment: "O apêndice sobre a Novilíngua é a parte mais assustadora." }, participant: { rating: 4.5 } },
  // Orgulho e Preconceito
  { owner: { rating: 5, comment: "A ironia da Austen não envelhece um dia." }, admin: { rating: 2.5, comment: "Reconheço o mérito, mas não é o meu tipo de tensão." }, participant: { rating: 4 } },
  // O Sol é para Todos
  { owner: { rating: 5 }, admin: { rating: 3.5 }, participant: { rating: 4.5, comment: "Chorei no julgamento." } },
  // Crime e Castigo
  { owner: { rating: 5, comment: "Os capítulos na cabeça do Raskólnikov são sufocantes — e é esse o ponto." }, admin: { rating: 3 }, participant: { rating: 3.5 } },
  // O Pequeno Príncipe
  { owner: { rating: 4 }, admin: { rating: 3 }, participant: { rating: 5, comment: "Releio sempre que a vida fica dura." } },
  // Duna
  { owner: { rating: 2.5, comment: "Muita política de especiaria, pouca gente pra me importar." }, admin: { rating: 5, comment: "O worldbuilding mais completo que já li." }, participant: { rating: 4 } },
  // A Revolução dos Bichos
  { owner: { rating: 4 }, admin: { rating: 4.5 }, participant: { rating: 4 } },
  // Ensaio sobre a Cegueira
  { owner: { rating: 4.5, comment: "A prosa sem parágrafo te tira o chão junto com os personagens." }, admin: { rating: 3.5 }, participant: { rating: 3 } },
  // O Nome do Vento
  { owner: { rating: 2, comment: "Prosa bonita a serviço de um herói que acerta tudo." }, admin: { rating: 5, comment: "Voltei a ler fantasia por causa desse livro." }, participant: { rating: 4.5 } },
  // Um Defeito de Cor
  { owner: { rating: 4.5 }, admin: { rating: 4 }, participant: { rating: 5, comment: "As quase mil páginas passam voando. Devia ser leitura obrigatória." } },
];

export const BOOKSHELF_TITLE = "Estante";
export const BOOKSHELF_HEADLINE = "10 livros marcantes, 3 estantes que não se parecem";
export const BOOKSHELF_SUMMARY = "Uma estante sem datas: com notas, comentários, e um resultado que mostra o perfil de gosto de cada um.";
