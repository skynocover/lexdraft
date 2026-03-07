export const HEADER_SECTION = '__header__';
export const FOOTER_SECTION = '__footer__';

export const isPreformattedSection = (section: string | null | undefined): boolean =>
  section === HEADER_SECTION || section === FOOTER_SECTION;

/**
 * Detect if paragraph text starts with a legal list numbering pattern.
 * These paragraphs should NOT have text-indent (they're enumerated items, not prose).
 *
 * Matches: 一、 二、 (一) (二) 1. 2. 1、 2、
 */
const LEGAL_LIST_PATTERN =
  /^[一二三四五六七八九十百]+、|^（[一二三四五六七八九十百]+）|^\([一二三四五六七八九十百]+\)|^\d+[.、]/;

export const isListParagraph = (text: string | null | undefined): boolean => {
  if (!text) return false;
  return LEGAL_LIST_PATTERN.test(text.trimStart());
};
