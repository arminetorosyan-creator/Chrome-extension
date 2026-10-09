# diagram-kit

Tooling behind the [`diagram-architect`](../../.claude/agents/diagram-architect.md) agent. It takes **semantic** diagram source and produces validated, consistently styled, shareable output.

| Input | Pipeline | Output |
|---|---|---|
| `*.bpmn` (BPMN 2.0 XML without layout) | built-in layout engine (`lib/layout-bpmn.mjs`) → [bpmnlint](https://github.com/bpmn-io/bpmnlint) → [bpmn-js](https://github.com/bpmn-io/bpmn-js) import → headless Chromium | `.bpmn` rewritten with layout + colours, `.svg`, `.png` |
| `*.puml` (PlantUML) | neutral theme injected → [PlantUML](https://plantuml.com/) | `.svg`, `.png` |

## Setup

Requires Node ≥ 18, Java ≥ 11, curl.

```bash
tools/diagram-kit/setup.sh
```

Installs npm dependencies, downloads the pinned PlantUML jar (SHA-256 verified) into `vendor/`, and installs headless Chromium unless `PLAYWRIGHT_BROWSERS_PATH` already provides one. Graphviz is optional: without it PlantUML uses its built-in Smetana layout.

## Use

```bash
node tools/diagram-kit/render.mjs diagrams/<slug>/<slug>.bpmn --title "Title" --subtitle "v0.1 · Draft · 2026-10-09 · Owner: Name"
node tools/diagram-kit/render.mjs diagrams/<slug>/<slug>.puml
```

Exit code 1 = validation error. Examples live in [`diagrams/`](../../diagrams/).

## Using the agent in another repository

Copy `.claude/agents/diagram-architect.md` and `tools/diagram-kit/` (without `node_modules/` and `vendor/`), then run `setup.sh`.

## What is validated — and what is not

- BPMN: well-formed XML against the bpmn-moddle schema, the `bpmnlint:recommended` rule set (no disconnected nodes, start/end events present, labelled gateway branches, explicit merges, …), and a successful bpmn-js import. This is tooling validation, **not** a formal OMG conformance certification.
- PlantUML: syntax check by the PlantUML parser. It does not check that the diagram means what you intend — that is what the agent's clarification step and your review are for.

## Layout engine scope

Tested: pools (including black-box pools), lanes, message flows, boundary events, loops, exclusive/parallel gateways, data stores/objects, text annotations, collapsed sub-processes. Lane-less nodes inherit a lane from a neighbour and are reported as `[layout]` notes. Not supported: event sub-processes, expanded sub-process children, choreography diagrams. Connection routing is heuristic (it picks the candidate route crossing the fewest shapes); very dense diagrams should be split.

## Licences and sources

- bpmn-js is under the bpmn.io licence, which requires the bpmn.io logo to stay visible wherever the library *displays* a diagram; this kit only uses it headlessly to import and export SVG. If you embed the viewer in a page, follow the [licence](https://bpmn.io/license/).
- Standards: [BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2/), [UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/).
- PlantUML (MIT build, v1.2025.4): [releases](https://github.com/plantuml/plantuml/releases).
