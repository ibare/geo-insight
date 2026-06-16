# CLAUDE.md — GeoInsight 프로젝트 지침

## npm 릴리스 정책 (중요 — 패키지 변경 시 항상 따른다)

GeoInsight는 **npm으로 배포**된다. 패키지 코드를 고쳤으면 **버전을 올려 재발행**해야
호스트(methii 등)에 반영된다. "고치고 끝"이 아니라 "고치고 → 버전↑ → 발행 → 태그 push"가 한 단위다.

### 발행 대상 (4패키지, lockstep 동일 버전)

- npm org = `geo-insight`(하이픈 O), scope = `@geo-insight` 일치. **발행 4패키지는 버전을 항상 동기화**한다:

  | 패키지 | 디렉토리 | 발행 형태 | 의존 |
  |---|---|---|---|
  | `@geo-insight/data` | `packages/data` | tsc 빌드(`dist/src` + `dist/assets` 동봉) | 외부만 |
  | `@geo-insight/core` | `packages/core` | tsc 빌드(`dist`) | `data` |
  | `@geo-insight/runtime` | `packages/runtime` | tsc 빌드(`dist` + `styles.css`) | `core` |
  | `@geo-insight/tiptap` | `packages/host-tiptap-bundle` | Rollup self-contained 번들 | (전부 인라인) |

- `@geo-insight/host-tiptap`(소스)·`layer-editor`·`website`·`examples`는 **private — 발행 안 함**.
  host-tiptap 등은 tiptap 번들에 Rollup으로 인라인되므로 개별 발행 불필요.
- 의존은 `workspace:*` 그대로 둔다 — **`pnpm publish`가 발행 시 현재 버전으로 변환**한다.
  그래서 lockstep(동일 버전)이면 의존 버전 갱신을 따로 할 필요가 없다.
- `npm publish`(X) → **반드시 `pnpm publish`**. npm은 `workspace:*`를 변환하지 못해 깨진 패키지가 올라간다.
- `publishConfig.access: public` — 전부 공개.

### 릴리스 절차

워킹 트리가 **clean**해야 한다. 먼저 변경을 커밋한 뒤:

```bash
pnpm release:patch    # 버그fix·소소한 변경 (0.1.0 → 0.1.1)
pnpm release:minor    # 기능 추가, 하위호환 (0.1.0 → 0.2.0)
pnpm release:major    # 파괴적 변경 (0.1.0 → 1.0.0)
```

각 스크립트는 `release:check`(typecheck+test 게이트) 후 `scripts/release.mjs <bump>`를 돌린다:

1. 4패키지 버전 **동시** bump (`npm version --no-git-tag-version`)
2. 단일 커밋 + git 태그 `vX.Y.Z`
3. **의존 순서**(data → core → runtime → tiptap)로 `pnpm publish` — 각 `prepublishOnly`가 빌드
4. `git push --follow-tags`

### 발행 후 확인

`pnpm publish`가 성공을 출력해도 **read 복제본 전파에 수 분 걸린다**(`npm view` 404여도 성공일 수 있음).

```bash
npm view @geo-insight/tiptap version   # 새 버전과 일치하면 전파 완료
```

### 주의

- **버전 올리는 걸 잊지 말 것.** 같은 버전 재발행은 npm이 거부. 코드만 고치고 발행 안 하면 호스트 반영 0.
- data 등 하위 패키지만 고쳐도 **4개가 같이 버전이 올라간다**(lockstep). 이게 의존 일관성을 보장한다.
- methii 호스트는 `@geo-insight/tiptap`·필요 시 `@geo-insight/runtime` 등을 import한다(하이픈 O).
- 첫 발행이 private로 잡혔다면: `npm access public @geo-insight/<pkg>`.

---

## 프로젝트 구조 / DSL

전체 패키지 구성·DSL 문법·아키텍처는 [README.md](./README.md) 참조.

- `@geo-insight/core` — DSL → IR → SVG 컴파일러 (프레임워크/DOM 0)
- `@geo-insight/data` — 지오메트리 + 이름 resolver
- `@geo-insight/runtime` — 바닐라 DOM 마운트 + 줌/팬
- `@geo-insight/host-tiptap` — Tiptap 익스텐션 (소스)
- `@geo-insight/tiptap` — 위 전체 인라인한 **발행용 번들**
- `@geo-insight/layer-editor` — 환경 레이어 편집기 (Electron)

## 개발

```bash
pnpm install
pnpm test         # vitest 전체
pnpm typecheck    # 전 패키지 tsc --noEmit
pnpm build        # 각 패키지 + 번들 빌드
```

## 불변 원칙

1. 의미 우선 — 입력은 좌표가 아니라 이름·역할·관계.
2. 결정적·diffable — 같은 입력 = 바이트 동일 SVG.
3. 프레임워크 비종속 core — 순수 함수 `compile(source)`.
4. 헤드리스 core + 호스트 어댑터 분리.
5. 교육적 서사가 목적.
