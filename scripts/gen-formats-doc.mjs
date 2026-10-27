// Generates docs/FORMATS.md from shared/registry.json so documentation cannot drift from the code.
import { readFileSync, writeFileSync } from 'node:fs'

const reg = JSON.parse(readFileSync(new URL('../shared/registry.json', import.meta.url)))
const label = (f) => (f === '*' ? 'any file' : reg.formats[f].label)
const cat = (id) => reg.categories.find((c) => c.id === id).short

let md = `# Supported conversions\n\n> Generated from \`shared/registry.json\` by \`pnpm docs:formats\`. Do not edit by hand.\n> Every row below is exercised by an automated test (see the *Tests* column). Anything not listed is **not supported**.\n\n`
md += `| Tool | Category | Where it runs | Engine | From | To | Max size | Tests |\n|---|---|---|---|---|---|---|---|\n`
for (const t of reg.tools) {
  const from = t.inputs.map(label).join(', ')
  const to = t.targets.map((x) => x.label + (x.from ? ` (from ${x.from.map(label).join(', ')})` : '')).join('<br>')
  md += `| ${t.name}${t.combine ? ' *(combines all files)*' : ''} | ${cat(t.category)} | ${t.mode === 'browser' ? 'Browser (private)' : '**Server** (upload)'} | ${t.engine} | ${from} | ${to} | ${t.maxFileMB} MB | ${t.tests.map((x) => '`' + x + '`').join(', ')} |\n`
}
md += `\n## Limitations per tool\n\n`
for (const t of reg.tools) {
  md += `### ${t.name}\n\n` + t.notes.map((n) => `- ${n}`).join('\n') + '\n\n'
}
md += `## Explicitly not supported\n\n- PDF to flowing, fully editable Word paragraphs and Word tables (PDF to Word keeps the look but uses positioned text boxes); PDF to Excel/PowerPoint\n- HTML to PDF with JavaScript or modern CSS; converting a live web address\n- Handwriting recognition; OCR in languages not installed on the server\n- Redacting, signing, unlocking, protecting or repairing PDFs\n- Legacy .doc/.xls/.ppt, Apple iWork formats\n- HEIC/HEIF, AVIF, RAW, SVG image conversion\n- ZIP extraction to separate files; RAR and 7z\n- Password-protected / encrypted files\n- Any conversion not in the table above (there is no "every format to every format")\n`
writeFileSync(new URL('../docs/FORMATS.md', import.meta.url), md)
console.log('wrote docs/FORMATS.md')
