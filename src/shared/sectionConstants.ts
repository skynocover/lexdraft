export const HEADER_SECTION = '__header__';
export const FOOTER_SECTION = '__footer__';

export const isPreformattedSection = (section: string | null | undefined): boolean =>
  section === HEADER_SECTION || section === FOOTER_SECTION;
