import {
  Document,
  Packer,
  Paragraph as DocxParagraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Footer,
  PageNumber,
  convertMillimetersToTwip,
} from 'docx'
import { saveAs } from 'file-saver'
import type { Paragraph } from '../../../stores/useBriefStore'

const FONT = 'DFKai-SB'
const FONT_SIZE_PT = 14
const FONT_SIZE_HALF_PT = FONT_SIZE_PT * 2
const HEADING2_SIZE_HALF_PT = 16 * 2
const LINE_SPACING_PT = 25
const LINE_SPACING_TWIPS = Math.round(LINE_SPACING_PT * 20) // 1pt = 20 twips
const MARGIN_MM = 25

function buildCitationText(label: string): string {
  return `（${label}）`
}

export async function exportBriefToDocx(
  paragraphs: Paragraph[],
  title: string,
) {
  const children: DocxParagraph[] = []

  // Title
  children.push(
    new DocxParagraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200, line: LINE_SPACING_TWIPS },
      children: [
        new TextRun({
          text: title,
          font: FONT,
          size: 18 * 2,
          bold: true,
        }),
      ],
    }),
  )

  let prevSection = ''
  let prevSubsection = ''

  for (const p of paragraphs) {
    // Section heading
    if (p.section && p.section !== prevSection) {
      children.push(
        new DocxParagraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120, line: LINE_SPACING_TWIPS },
          children: [
            new TextRun({
              text: p.section,
              font: FONT,
              size: HEADING2_SIZE_HALF_PT,
              bold: true,
            }),
          ],
        }),
      )
      prevSection = p.section
      prevSubsection = ''
    }

    // Subsection heading
    if (p.subsection && p.subsection !== prevSubsection) {
      children.push(
        new DocxParagraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 120, after: 60, line: LINE_SPACING_TWIPS },
          children: [
            new TextRun({
              text: p.subsection,
              font: FONT,
              size: FONT_SIZE_HALF_PT,
              bold: true,
            }),
          ],
        }),
      )
      prevSubsection = p.subsection
    }

    // Paragraph body
    const runs: TextRun[] = []

    if (p.segments && p.segments.length > 0) {
      for (const seg of p.segments) {
        if (seg.text) {
          runs.push(
            new TextRun({
              text: seg.text,
              font: FONT,
              size: FONT_SIZE_HALF_PT,
            }),
          )
        }
        for (const c of seg.citations) {
          runs.push(
            new TextRun({
              text: buildCitationText(c.label),
              font: FONT,
              size: FONT_SIZE_HALF_PT,
              color: c.type === 'law' ? '6d28d9' : '1d4ed8',
            }),
          )
        }
      }
    } else {
      if (p.content_md) {
        runs.push(
          new TextRun({
            text: p.content_md,
            font: FONT,
            size: FONT_SIZE_HALF_PT,
          }),
        )
      }
      for (const c of p.citations) {
        runs.push(
          new TextRun({
            text: buildCitationText(c.label),
            font: FONT,
            size: FONT_SIZE_HALF_PT,
            color: c.type === 'law' ? '6d28d9' : '1d4ed8',
          }),
        )
      }
    }

    children.push(
      new DocxParagraph({
        indent: { firstLine: convertMillimetersToTwip(10) }, // ~2em indent
        spacing: { after: 60, line: LINE_SPACING_TWIPS },
        children: runs,
      }),
    )
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(210),
              height: convertMillimetersToTwip(297),
            },
            margin: {
              top: convertMillimetersToTwip(MARGIN_MM),
              bottom: convertMillimetersToTwip(MARGIN_MM),
              left: convertMillimetersToTwip(MARGIN_MM),
              right: convertMillimetersToTwip(MARGIN_MM),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new DocxParagraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: FONT,
                    size: 12 * 2,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${title}.docx`)
}
