# CLAUDE.md — GeoInsight 프로젝트 지침

## npm 릴리스 정책 (중요 — 패키지 변경 시 항상 따른다)

GeoInsight는 **npm으로 배포**된다. 패키지 코드를 고쳤으면 **버전을 올려 재발행**해야
호스트(methii 등)에 반영된다. "고치고 끝"이 아니라 "고치고 → 버전↑ → 발행 → 태그 push"가 한 단위다.

### 발행 대상

- **발행되는 패키지는 `@geo-insight/tiptap` (`packages/host-tiptap-bundle`) 하나뿐.**
  나머지 `@geo-insight/*`(core·data·runtime·host-tiptap 등)는 이 번들에 Rollup으로 인라인되므로
  **개별 발행하지 않는다.** core/data 등을 고쳐도 발행은 번들 한 번으로 끝난다.
- npm org = `geo-insight`(하이픈 O), scope = `@geo-insight` 일치. 모노레포 전체 scope 통일됨.
- `publishConfig.access: public` — 공개 패키지.

### 릴리스 절차

워킹 트리가 **clean**해야 한다(`npm version`이 요구). 먼저 변경을 커밋한 뒤:

```bash
pnpm release:patch    # 버그fix·소소한 변경 (0.1.0 → 0.1.1)
pnpm release:minor    # 기능 추가, 하위호환 (0.1.0 → 0.2.0)
pnpm release:major    # 파괴적 변경 (0.1.0 → 1.0.0)
```

각 스크립트가 자동으로 수행하는 단계(루트 `package.json`에 정의):

1. `release:check` — `pnpm typecheck && pnpm test` 게이트 (실패 시 중단)
2. `npm version <bump>` — 번들 `package.json` 버전↑ + 커밋 + git 태그 `vX.Y.Z` 생성
3. `npm publish` — `prepublishOnly`가 Rollup 빌드 → 발행 (`.map` 제외, LICENSE/README 동봉)
4. `git push --follow-tags` — main 커밋 + 태그 push

### 발행 후 확인

`npm publish`가 `+ @geo-insight/tiptap@X.Y.Z`를 출력해도 **read 복제본 전파에 수 분 걸린다**
(신규 scope 첫 패키지는 특히). 곧바로 `npm view`가 404여도 발행은 성공한 것일 수 있다.

```bash
npm view @geo-insight/tiptap version   # 새 버전과 일치하면 전파 완료
```

### 주의

- **버전 올리는 걸 잊지 말 것.** 같은 버전으로는 재발행 불가(npm이 거부). 코드만 고치고 발행 안 하면
  호스트엔 아무 반영도 안 된다.
- methii 호스트는 `@geo-insight/tiptap`을 import한다(하이픈 O). 발행명이 바뀌면 호스트도 갱신 필요.
- 첫 발행이 private로 잡혔다면: `npm access public @geo-insight/tiptap`.

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
