import { Lato, Poppins } from "next/font/google";

/** The exported log's two faces, shared by its own page and the in-app modal. */
export const exportDisplay = Poppins({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800"], variable: "--xd-font-display" });
export const exportText = Lato({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], variable: "--xd-font-text" });
export const exportFontClass = `${exportDisplay.variable} ${exportText.variable}`;
