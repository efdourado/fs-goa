/**
 * One size for every box on a page — challenge, group, library and catalogue-cover cards alike. Grids and
 * sideways rails share the same columns (1, then 2 from `sm`, 3 from `md`, 4 from `lg`), so a card is exactly as
 * wide in a rail as in a grid and grows and shrinks smoothly between the breakpoints. The rail column widths
 * assume the gap `Rail` uses: 1rem, then 1.25rem from `sm`. Below `sm` a rail card is most of the screen with a
 * peek of the next; covers, being posters, stay smaller there and sit two to a row in a grid.
 */
export const CARD_GRID = "grid gap-4 sm:grid-cols-2 sm:gap-5 md:grid-cols-3 lg:grid-cols-4";
export const COVER_GRID = "grid grid-cols-2 gap-x-4 gap-y-7 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4";

const FROM_SM = "sm:w-[calc((100%_-_1.25rem)/2)] sm:max-w-none md:w-[calc((100%_-_2.5rem)/3)] lg:w-[calc((100%_-_3.75rem)/4)]";
export const CARD_COLUMN = `w-[78vw] max-w-[19rem] flex-none snap-start ${FROM_SM}`;
export const COVER_COLUMN = `w-44 flex-none snap-start ${FROM_SM}`;
