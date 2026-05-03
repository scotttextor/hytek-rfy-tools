// Bisect what feature breaks Word. Generates four test files:
//   TEST_1_basic.docx     — headings + para only (no tables, no numbering, no headers)
//   TEST_2_tables.docx    — adds tables
//   TEST_3_numbering.docx — adds bullet/number lists
//   TEST_4_headers.docx   — adds page headers/footers
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, BorderStyle, WidthType, ShadingType,
  PageNumber, LevelFormat,
} = require("docx");

const docs = path.join(__dirname, "..", "docs");

function basicChildren() {
  return [
    new Paragraph({ children: [new TextRun({ text: "Heading", bold: true, size: 32 })] }),
    new Paragraph({ children: [new TextRun({ text: "Body paragraph one." })] }),
    new Paragraph({ children: [new TextRun({ text: "Body paragraph two with bold and color.", bold: true, color: "231F20" })] }),
  ];
}

function tableChildren() {
  const cell = (t, opts = {}) => new TableCell({
    borders: { top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" }, bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" }, left: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" }, right: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" } },
    width: { size: 4000, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: t, bold: opts.bold })] })],
  });
  return [
    ...basicChildren(),
    new Table({
      width: { size: 8000, type: WidthType.DXA },
      rows: [
        new TableRow({ children: [cell("Field", { bold: true, fill: "231F20" }), cell("Value", { bold: true, fill: "231F20" })] }),
        new TableRow({ children: [cell("Name"), cell("HYTEK")] }),
        new TableRow({ children: [cell("Color"), cell("Yellow")] }),
      ],
    }),
  ];
}

function numberingChildren() {
  return [
    ...tableChildren(),
    new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Bullet item 1")] }),
    new Paragraph({ numbering: { reference: "bullets", level: 0 }, children: [new TextRun("Bullet item 2")] }),
    new Paragraph({ numbering: { reference: "numbers", level: 0 }, children: [new TextRun("Numbered item 1")] }),
  ];
}

function build(name, children, withNumbering, withHeaderFooter) {
  const doc = new Document({
    creator: "HYTEK", title: name,
    styles: { default: { document: { run: { font: "Arial", size: 21 } } } },
    ...(withNumbering ? {
      numbering: {
        config: [
          { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] },
          { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] },
        ],
      },
    } : {}),
    sections: [{
      ...(withHeaderFooter ? {
        headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: "Header", size: 16 })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16 })] })] }) },
      } : {}),
      children,
    }],
  });
  const out = path.join(docs, name + ".docx");
  return Packer.toBuffer(doc).then(buf => { fs.writeFileSync(out, buf); console.log("Wrote", out, `(${buf.length} bytes)`); });
}

(async () => {
  await build("TEST_1_basic", basicChildren(), false, false);
  await build("TEST_2_tables", tableChildren(), false, false);
  await build("TEST_3_numbering", numberingChildren(), true, false);
  await build("TEST_4_headers", numberingChildren(), true, true);
})();
