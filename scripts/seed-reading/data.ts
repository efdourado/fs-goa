/**
 * A single, rich, solo reading challenge for `@dudupizzas`: 90 days, six real
 * books, 2 201 pages, every book finished and rated, pages logged day by day
 * with a believable rhythm (weekday commutes, weekend sessions, a couple of
 * binge days, two quieter weeks). Deliberately a *strong* run — a showcase of
 * what the Library recipe can do, not an average one.
 *
 * Everything is deterministic: the daily log is derived from a fixed seed so
 * repeated runs (after `--reset`) produce the exact same numbers.
 */

export const WINDOW_DAYS = 90;
export const WEEKS = Math.ceil(WINDOW_DAYS / 7); // 13

export const SEED_TITLE = "90 dias de leitura";
export const SEED_DESCRIPTION = "Um trimestre de leitura: páginas registradas todo dia, 6 livros terminados, cada um com nota e um comentário.";
export const SEED_HEADLINE = "6 livros, 2.201 páginas, um trimestre de leitura.";
export const SEED_SUMMARY = "Desafio pessoal de leitura: páginas por dia, um livro por vez, nota e comentário ao terminar. Métricas de ritmo semanal, páginas por gênero e ranking dos livros.";

export interface SeedBook {
  title: string;
  author: string;
  year: number;
  pageCount: number;
  mainGenre: string;
  /** Inclusive day-offset window this book was the "current read". */
  window: [start: number, end: number];
  /** Extra binge days (day offsets) — a flight, a sick day, a rainy Sunday. */
  binges: number[];
  rating: number;
  comment: string;
}

export const BOOKS: SeedBook[] = [
  {
    title: "Project Hail Mary",
    author: "Andy Weir",
    year: 2021,
    pageCount: 496,
    mainGenre: "Ficção científica",
    window: [0, 15],
    binges: [6, 13],
    rating: 4.5,
    comment:
      "Li mais de 150 páginas no domingo. Tem bastante ciência, mas não fica chato. E o Rocky é muito bom.",
  },
  {
    title: "Klara and the Sun",
    author: "Kazuo Ishiguro",
    year: 2021,
    pageCount: 320,
    mainGenre: "Ficção literária",
    window: [16, 30],
    binges: [24],
    rating: 4.5,
    comment:
      "Esse eu fui lendo mais devagar. A Klara vai contando as coisas e vc vai entendendo outras antes dela. Quando percebe, já tá triste.",
  },
  {
    title: "The Left Hand of Darkness",
    author: "Ursula K. Le Guin",
    year: 1969,
    pageCount: 304,
    mainGenre: "Ficção científica",
    window: [31, 46],
    binges: [],
    rating: 4,
    comment:
      "Peguei pra ler bem quando tava sem tempo pra nada. Teve dia de ler 15 páginas e teve dia que nem abri o livro. Demorei pra engatar, mas a parte da travessia no gelo valeu a pena",
  },
  {
    title: "Educated",
    author: "Tara Westover",
    year: 2018,
    pageCount: 334,
    mainGenre: "Memória",
    window: [47, 62],
    binges: [52],
    rating: 4,
    comment:
      "Primeiro de não ficção do desafio. Tem umas coisas que vc lê e custa acreditar que aconteceram de verdade.",
  },
  {
    title: "Piranesi",
    author: "Susanna Clarke",
    year: 2020,
    pageCount: 245,
    mainGenre: "Fantasia",
    window: [63, 72],
    binges: [70],
    rating: 5,
    comment:
      "Meu favorito do desafio. No começo eu não estava entendendo nada, mas estava gostando mesmo assim.",
  },
  {
    title: "The Overstory",
    author: "Richard Powers",
    year: 2018,
    pageCount: 502,
    mainGenre: "Ficção literária",
    window: [73, 88],
    binges: [80, 86],
    rating: 4.5,
    comment:
      "Deixei o maior pro final e achei que não ia dar tempo.",
  },
];

// ── deterministic daily log ──────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `[dayOffset, pages]` for one book. Each day gets a *weight* — 0 on a rest day
 * (~1 in 7), heavier on weekends, a big spike on the listed binge days — and the
 * weights are then scaled to pages so the log sums to **exactly** `book.pageCount`
 * (rounding drift is trued day by day, never dumped on the last day).
 */
export function readingLog(book: SeedBook): Array<[day: number, pages: number]> {
  const [start, end] = book.window;
  const rand = mulberry32((book.year * 1000 + book.pageCount) | 0);
  const MIN_PAGES = 6;

  const weighted: Array<[day: number, weight: number]> = [];
  for (let offset = start; offset <= end; offset += 1) {
    const weekend = offset % 7 === 5 || offset % 7 === 6;
    const edge = offset === start || offset === end;
    if (!edge && rand() < 0.14) { weighted.push([offset, 0]); continue; }
    let weight = (weekend ? 1.55 : 0.9) * (0.65 + 0.7 * rand());
    if (book.binges.includes(offset)) weight *= 2.6 + rand();
    weighted.push([offset, weight]);
  }

  const reading = weighted.filter(([, weight]) => weight > 0);
  const totalWeight = reading.reduce((sum, [, weight]) => sum + weight, 0);
  const pages = reading.map(([, weight]) => Math.max(MIN_PAGES, Math.round((book.pageCount * weight) / totalWeight)));

  let drift = book.pageCount - pages.reduce((sum, n) => sum + n, 0);
  for (let i = pages.length - 1; drift !== 0; i = i === 0 ? pages.length - 1 : i - 1) {
    const step = drift > 0 ? 1 : -1;
    if (pages[i] + step >= MIN_PAGES) { pages[i] += step; drift -= step; }
  }

  return reading.map(([day], i) => [day, pages[i]] as [day: number, pages: number]);
}
