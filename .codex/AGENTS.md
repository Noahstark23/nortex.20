# ECC for Codex CLI

This supplements the root `AGENTS.md` with a repo-local ECC baseline.

## Repo Skill

- Repo-generated Codex skill: `.agents/skills/nortex.20/SKILL.md`
- Claude-facing companion skill: `.claude/skills/nortex.20/SKILL.md`
- Keep user-specific credentials and private MCPs in `~/.codex/config.toml`, not in this repo.

## MCP Baseline

Treat `.codex/config.toml` as the default ECC-safe baseline for work in this repository.
The generated baseline enables GitHub, Context7, Exa, Memory, Playwright, and Sequential Thinking.

## Multi-Agent Support

- Explorer: read-only evidence gathering
- Reviewer: correctness, security, and regression review
- Docs researcher: API and release-note verification

## Workflow Files

- `.github/workflows/ci.yml`: CI y staging automático exclusivamente para pushes a
  `main`; no contiene ningún job ni secreto de producción.
- `.github/workflows/release-production.yml`: único workflow con promoción manual
  de producción. Exige `candidate_sha`, `PROMOTE <SHA>`, staging con ese SHA y
  revalidación posterior a la aprobación del environment.
- Sigue `docs/runbooks/release-promotion.md`. No trates un workflow, un Environment
  verde ni una aprobación de GitHub como autorización de producto; no despaches,
  apruebes ni modifiques su configuración sin autorización separada.
