# {{Title}}

| | |
|---|---|
| **Diagram type** | {{BPMN 2.0 process / UML sequence / …}} |
| **Version** | {{0.1}} |
| **Status** | {{Draft / In review / Approved}} |
| **Owner** | {{name or team}} |
| **Date** | {{YYYY-MM-DD}} |
| **Audience** | {{who this is for}} |
| **Based on** | {{user description / PRD / link}} |

![{{Title}}](./{{slug}}.png)

Source: [`{{slug}}.{{bpmn|puml}}`](./{{slug}}.{{bpmn|puml}}) · Vector: [`{{slug}}.svg`](./{{slug}}.svg)

## At a glance

- {{One-sentence purpose of the process/system/model}}
- {{Who is involved}}
- {{Main outcome(s)}}
- {{Most important exception or risk}}

## Walkthrough

1. {{Trigger and first step}}
2. {{…}}
3. {{Decision: criterion → outcome A / outcome B}}
4. {{Exception path: what happens when …}}

## Legend & glossary

| Symbol / term | Meaning |
|---|---|
| {{only symbols and terms used in this diagram}} | {{plain-language definition}} |

Red elements show exception paths.

## Assumptions

| # | Assumption | Why assumed |
|---|---|---|
| A1 | {{…}} | {{not stated in the description}} |

## Open questions

| # | Question | Suggested owner |
|---|---|---|
| Q1 | {{…}} | {{role/person}} |

## How to edit

- `.bpmn`: open in [bpmn.io demo](https://demo.bpmn.io) or Camunda Modeler. Layout is generated; re-run the renderer after semantic changes.
- `.puml`: edit in any PlantUML editor; render with `node tools/diagram-kit/render.mjs <file>`.

## Change log

| Version | Date | Change | By |
|---|---|---|---|
| {{0.1}} | {{YYYY-MM-DD}} | Initial draft | {{owner}} |
