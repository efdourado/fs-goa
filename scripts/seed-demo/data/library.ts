import type { Role } from "../scenarios/shared";

/**
 * A six-week reading club over three real books, with pages logged on scattered
 * days and two deliberately empty weeks so the schedule shows pauses.
 */

export interface DemoBook {
  title: string;
  author: string;
  year: number;
  pageCount: number;
  mainGenre: string;
  /** 1-based week the book is organised under. Weeks 3 and 5 stay empty. */
  week: number;
}

export const BOOKS: DemoBook[] = [
  { title: "Torto Arado", author: "Itamar Vieira Junior", year: 2019, pageCount: 264, mainGenre: "Drama", week: 1 },
  { title: "Klara e o Sol", author: "Kazuo Ishiguro", year: 2021, pageCount: 320, mainGenre: "Ficção científica", week: 2 },
  { title: "Cem Anos de Solidão", author: "Gabriel García Márquez", year: 1967, pageCount: 432, mainGenre: "Realismo mágico", week: 4 },
];

interface ReadingLog {
  /** `[dayOffset, pages]` — dayOffset counts from the challenge start (0-based). */
  pages: Array<[number, number]>;
  finished: boolean;
  rating?: number;
  comment?: string;
}

/** `READING[bookIndex][role]`. */
export const READING: Array<Record<Role, ReadingLog>> = [
  // Torto Arado — everyone finishes, strong reception
  {
    owner: {
      pages: [[1, 40], [2, 55], [4, 60], [6, 50], [8, 59]],
      finished: true, rating: 5,
      comment: "A troca de narradora no meio do livro é um soco. Não largava mais.",
    },
    admin: {
      pages: [[2, 30], [3, 45], [7, 50], [9, 70], [12, 69]],
      finished: true, rating: 4.5,
      comment: "Demorei a entrar, mas a segunda metade me ganhou por completo.",
    },
    participant: {
      pages: [[1, 60], [3, 80], [5, 64], [9, 60]],
      finished: true, rating: 4.5,
    },
  },
  // Klara e o Sol — the owner drifts off; the others land differently
  {
    owner: {
      pages: [[10, 35], [13, 20], [17, 25]],
      finished: false,
      comment: "Larguei na metade. A voz da Klara cansou antes de me tocar.",
    },
    admin: {
      pages: [[9, 50], [11, 60], [14, 55], [16, 60], [18, 55], [20, 40]],
      finished: true, rating: 4,
      comment: "Um livro sobre amor visto por quem não sabe o que é amor. Fiquei pensativo.",
    },
    participant: {
      pages: [[10, 70], [12, 80], [15, 90], [17, 80]],
      finished: true, rating: 3.5,
      comment: "Bonito, mas o final entrega menos do que a premissa promete.",
    },
  },
  // Cem Anos de Solidão — the marathon; only two finish it
  {
    owner: {
      pages: [[22, 45], [24, 50], [27, 60], [30, 55], [33, 60], [36, 55], [39, 57]],
      finished: true, rating: 5,
      comment: "Reli depois de dez anos e continua sendo o livro que mais me desorienta, no melhor sentido.",
    },
    admin: {
      pages: [[23, 30], [26, 40], [31, 35], [37, 45]],
      finished: false,
      comment: "Perdi o fio nos Aurelianos. Volto pra ele com uma árvore genealógica do lado.",
    },
    participant: {
      pages: [[22, 80], [25, 90], [28, 100], [31, 90], [35, 72]],
      finished: true, rating: 4,
    },
  },
];

export const LIBRARY_TITLE = "Clube de leitura — Demo";
export const LIBRARY_HEADLINE = "3 livros, 6 semanas, 2 pausas no meio";
export const LIBRARY_SUMMARY = "Um clube de leitura fechado: páginas registradas dia a dia, cada livro marcado como concluído ou não, e nota ao terminar.";
