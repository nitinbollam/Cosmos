import fs from 'fs'
import { marked } from 'marked'

const planPath = '.cursor/plans/missing_features_linear_tasks_93dc93d3.plan.md'
let md = fs.readFileSync(planPath, 'utf8')
md = md.replace(/^---[\s\S]*?---\n/, '')
md = md.replace(
  /```mermaid[\s\S]*?```/g,
  '\n> _Diagram omitted in PDF — see the plan markdown for the mermaid flowchart._\n',
)
const body = marked.parse(md)
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Missing Features — Linear Task Backlog</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
  h1 { font-size: 22pt; border-bottom: 2px solid #222; padding-bottom: 8px; margin-top: 0; page-break-after: avoid; }
  h2 { font-size: 15pt; margin-top: 24px; border-bottom: 1px solid #ccc; padding-bottom: 4px; page-break-after: avoid; }
  h3 { font-size: 12pt; margin-top: 16px; color: #222; page-break-after: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 10pt; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f4f4f4; font-weight: 600; }
  code { font-family: Menlo, monospace; font-size: 9pt; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
  blockquote { border-left: 3px solid #888; margin: 12px 0; padding: 4px 12px; color: #444; font-style: italic; }
  hr { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
  ul { padding-left: 20px; }
</style>
</head>
<body>
${body}
</body>
</html>`
fs.writeFileSync('.cursor/plans/missing_features_linear_tasks_93dc93d3.html', html)
console.log('HTML written')
