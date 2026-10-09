#!/usr/bin/env node
// Validate, lay out and render a diagram source file.
//
//   node tools/diagram-kit/render.mjs <file.bpmn|file.puml> [options]
//
// Options:
//   --title "..."      Title band on the BPMN PNG (PlantUML: use `title` in source)
//   --subtitle "..."   Metadata line under the title, e.g. "v1.0 · Draft · 2026-10-09 · Owner: Jane"
//   --keep-layout      BPMN only: keep existing DI instead of re-running auto-layout
//
// Writes <name>.svg and <name>.png next to the source. For BPMN the source
// file is rewritten in place with generated layout + colours so it opens
// cleanly in Camunda Modeler / bpmn.io / Signavio.
// Exit code 1 = validation error (fix the source and re-run).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';
import { Linter } from 'bpmnlint';
import NodeResolver from 'bpmnlint/lib/resolver/node-resolver.js';
import { chromium } from 'playwright-core';
import { layoutBpmn, COLOR_ATTR_WARNING } from './lib/layout-bpmn.mjs';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const PLANTUML_JAR = path.join(KIT, 'vendor', 'plantuml.jar');
const THEME = path.join(KIT, 'themes', 'neutral.puml');

function parseArgs(argv) {
  const opts = { files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title') opts.title = argv[++i];
    else if (a === '--subtitle') opts.subtitle = argv[++i];
    else if (a === '--keep-layout') opts.keepLayout = true;
    else opts.files.push(a);
  }
  return opts;
}

const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exitCode = 1;
};

// ---------------------------------------------------------------- BPMN ----

async function lintBpmn(xml) {
  const moddle = new BpmnModdle();
  const { rootElement, warnings } = await moddle.fromXML(xml);
  const linter = new Linter({
    config: { extends: 'bpmnlint:recommended' },
    resolver: new NodeResolver({ require: createRequire(import.meta.url) }),
  });
  const results = await linter.lint(rootElement);
  const problems = [];
  for (const w of warnings.filter((x) => !COLOR_ATTR_WARNING.test(x.message))) problems.push({ category: 'error', rule: 'xml', message: w.message });
  for (const [rule, reports] of Object.entries(results)) {
    for (const r of reports) problems.push({ category: r.category, rule, id: r.id, message: r.message });
  }
  return problems;
}

function chromiumPath() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(base)) return undefined;
  for (const dir of fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const exe = path.join(base, dir, 'chrome-linux', 'chrome');
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

const esc = (str) => String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// Headless page that imports the XML with bpmn-js and returns the SVG export.
function viewerHtml() {
  const asset = (p) => fs.readFileSync(path.join(KIT, 'node_modules', 'bpmn-js', 'dist', p), 'utf8');
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${asset('assets/diagram-js.css')}${asset('assets/bpmn-js.css')}#canvas{width:4000px;height:3000px}</style></head>
<body><div id="canvas"></div>
<script>${asset('bpmn-viewer.production.min.js')}</script>
<script>
window.render = async (xml) => {
  const viewer = new BpmnJS({ container: '#canvas' });
  const { warnings } = await viewer.importXML(xml);
  const { svg } = await viewer.saveSVG();
  return { svg, warnings: warnings.map(w => w.message) };
};
</script></body></html>`;
}

// Printable sheet: optional title band + the exported SVG on white.
function sheetHtml(svg, { title, subtitle }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#fff;font-family:Arial,Helvetica,sans-serif}
#sheet{display:inline-block;padding:24px 28px}
#hdr{border-bottom:2px solid #2F5D8A;margin-bottom:16px;padding-bottom:8px}
#hdr h1{margin:0;font-size:22px;color:#1F3A57}
#hdr p{margin:4px 0 0;font-size:12px;color:#607D8B}
svg{display:block}
</style></head><body><div id="sheet">
${title ? `<div id="hdr"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>` : ''}
${svg}</div></body></html>`;
}

async function renderBpmn(file, opts) {
  let xml = fs.readFileSync(file, 'utf8');
  if (!opts.keepLayout) {
    const res = await layoutBpmn(xml);
    xml = res.xml;
    res.notes.forEach((n) => console.log(`  ⚠ [layout] ${n}`));
    fs.writeFileSync(file, xml);
    console.log(`✔ layout generated → ${file}`);
  }

  const problems = await lintBpmn(xml);
  const errors = problems.filter((p) => p.category === 'error');
  for (const p of problems) console.log(`  ${p.category === 'error' ? '✖' : '⚠'} [${p.rule}] ${p.id ? p.id + ': ' : ''}${p.message}`);
  if (errors.length) return fail(`${errors.length} BPMN validation error(s) in ${file} — fix the source and re-run`);
  console.log(`✔ bpmnlint (recommended): ${problems.length ? problems.length + ' warning(s)' : 'clean'}`);

  const browser = await chromium.launch({ executablePath: chromiumPath() });
  try {
    const page = await browser.newPage({ deviceScaleFactor: 2 });
    await page.setContent(viewerHtml());
    const res = await page.evaluate((x) => window.render(x), xml);
    const { svg } = res;
    const warnings = res.warnings.filter((w) => !COLOR_ATTR_WARNING.test(w));
    if (warnings.length) {
      warnings.forEach((w) => console.log(`  ✖ [import] ${w}`));
      return fail('bpmn-js reported import warnings');
    }
    const base = file.replace(/\.bpmn$/i, '');
    fs.writeFileSync(`${base}.svg`, svg);
    await page.setContent(sheetHtml(svg, opts));
    await page.locator('#sheet').screenshot({ path: `${base}.png` });
    console.log(`✔ rendered → ${base}.svg, ${base}.png`);
  } finally {
    await browser.close();
  }
}

// ------------------------------------------------------------ PlantUML ----

function hasGraphviz() {
  return spawnSync('dot', ['-V']).status === 0;
}

function renderPuml(file) {
  if (!fs.existsSync(PLANTUML_JAR)) return fail(`PlantUML not installed — run tools/diagram-kit/setup.sh`);
  const src = fs.readFileSync(file, 'utf8');
  if (!/@startuml/.test(src)) return fail(`${file} has no @startuml block`);

  // Theme is injected at render time so the committed source stays portable.
  const cfg = path.join(path.dirname(file), '.render-config.puml');
  let config = fs.readFileSync(THEME, 'utf8');
  if (!hasGraphviz()) config += '\n!pragma layout smetana\n';
  fs.writeFileSync(cfg, config);
  try {
    for (const fmt of ['svg', 'png']) {
      const r = spawnSync('java', ['-Djava.awt.headless=true', '-jar', PLANTUML_JAR, '-config', cfg, `-t${fmt}`, '-failfast2', '-charset', 'UTF-8', file], { encoding: 'utf8' });
      const out = `${r.stdout}${r.stderr}`.split('\n').filter((l) => l && !l.startsWith('Picked up JAVA_TOOL_OPTIONS')).join('\n');
      if (r.status !== 0 || /error/i.test(out)) {
        console.log(out);
        // Surface the line PlantUML choked on.
        const chk = spawnSync('java', ['-jar', PLANTUML_JAR, '-syntax'], { input: src, encoding: 'utf8' });
        console.log(chk.stdout.trim());
        return fail(`PlantUML syntax error in ${file}`);
      }
    }
  } finally {
    fs.rmSync(cfg, { force: true });
  }
  const base = file.replace(/\.(puml|plantuml)$/i, '');
  console.log(`✔ rendered → ${base}.svg, ${base}.png`);
}

// ---------------------------------------------------------------- main ----

const opts = parseArgs(process.argv.slice(2));
if (!opts.files.length) {
  console.error('usage: node tools/diagram-kit/render.mjs <file.bpmn|file.puml> [--title T] [--subtitle S] [--keep-layout]');
  process.exit(2);
}
for (const f of opts.files) {
  if (!fs.existsSync(f)) { fail(`not found: ${f}`); continue; }
  if (/\.bpmn$/i.test(f)) await renderBpmn(f, opts);
  else if (/\.(puml|plantuml)$/i.test(f)) renderPuml(f);
  else fail(`unsupported file type: ${f}`);
}
