#!/usr/bin/env node
// GeoInsight 릴리스 오케스트레이터 — 발행 4패키지를 lockstep(동일 버전)으로 범프·발행한다.
//
// 사용: node scripts/release.mjs <patch|minor|major>
//   (보통 직접 호출하지 말고 루트 `pnpm release:patch|minor|major` 로 호출 — typecheck/test 게이트 포함)
//
// 동작: 4패키지 버전 동시 bump(태그 없이) → 커밋 → 태그 vX.Y.Z → 의존 순서로 pnpm publish → push.
// workspace:* 의존은 pnpm publish 가 현재 버전으로 변환하므로 의존 버전 갱신은 자동.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const bump = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('usage: node scripts/release.mjs <patch|minor|major>');
  process.exit(1);
}

// 발행 순서 = 의존 순서 (data → core → runtime → tiptap 번들)
const PKGS = ['data', 'core', 'runtime', 'host-tiptap-bundle'];
const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });

// 1. 4패키지 버전 동시 bump (개별 커밋/태그 없이)
for (const p of PKGS) run(`npm version ${bump} --no-git-tag-version`, `packages/${p}`);

// 새 버전 (번들 기준 — 전부 동일)
const v = JSON.parse(readFileSync('packages/host-tiptap-bundle/package.json', 'utf8')).version;

// 2. 커밋 + 단일 태그
run(`git commit -aqm "chore: release v${v}"`);
run(`git tag v${v}`);

// 3. 의존 순서로 발행 (각 prepublishOnly 가 빌드 수행)
for (const p of PKGS) run('pnpm publish --no-git-checks', `packages/${p}`);

// 4. main + 태그 push
run('git push --follow-tags');
console.log(`\n✓ released v${v} — @geo-insight/{data,core,runtime,tiptap}`);
