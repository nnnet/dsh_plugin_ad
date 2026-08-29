# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

This repository (`dsh_plugin_ad`) is currently a bare scaffold. The only files tracked in git are `.gitignore` and `README.md`. There is no `package.json`, build configuration, source code, or test suite checked in yet — do not assume any tooling (npm/pnpm/yarn, tsc, test runners, linters) is set up until it actually exists in the tree.

Directories present on disk (`dsh-ad-pet/`, `contracts/`, `lib/`, `openspec/`) are empty or contain only gitignored build artifacts (`*.tsbuildinfo`). A stale `.tsbuildinfo` under `dsh-ad-pet/lib/` hints at a previously-planned TypeScript source layout (`src/index.ts`, `src/service.ts`, `src/http.ts`, `src/routes.ts`, `src/client/`, `src/locales/`, using React JSX and a Cordis-based service framework), but none of that source exists in the working tree — treat it as historical residue, not current architecture.

`openspec/` is initialized (`openspec/config.yaml`) for spec-driven development via the `openspec-*` / `opsx:*` skills, but `openspec/specs/` and `openspec/changes/` are currently empty — no specs or change proposals have been written yet.

## Working in this repo

- Before assuming a command, config, or architecture exists, verify it's actually present in the tree (`git ls-files`, `find`) — most of the directory structure here is aspirational/empty.
- When real source code and a package manifest are added, update this file with actual build/lint/test commands and architecture notes.
