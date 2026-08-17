# my-note-web

자유 배치형 타이핑 필기 웹. 아키텍처 배경은 `../architecture_analysis.md` 참고.

## 실행

```bash
npm install
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드 (tsc -b && vite build)
npm test         # vitest (좌표 변환, resize 계산 등 순수 함수 단위 테스트)
```

## 현재 상태

**Phase 1** — World Coordinate / Viewport(zoom, panX, panY), 마우스 중심 확대/축소, 캔버스 이동(스페이스+드래그, 휠클릭 드래그).

**Phase 2** — Object 데이터 구조(Text/Image/Annotation/Arrow/Shape 타입, Arrow·Shape는 타입만), objectsStore/interactionStore, 클릭 선택, 드래그 이동, 8방향 리사이즈 핸들, 빈 캔버스 클릭 시 선택 해제. `computeResizedBox`, `screenToWorld/worldToScreen/zoomAtPoint`는 vitest로 검증됨.

**Phase 3** — 텍스트 객체 더블클릭 시 줄 단위 contentEditable 편집 진입. indentation은 공백이 아니라 anchor 체인(`objects/text/indentation/anchorEngine.ts`)으로 관리:
- Enter는 그 자체로 들여쓰기를 만들지 않음. 현재 줄에 `:`가 있을 때만 그 다음 위치(DOM 실측, `Range.getBoundingClientRect()`)를 기준으로 새 anchor 생성.
- 빈 줄에 `-`/`·`를 처음 입력하는 순간에만 직전 줄과 비교해 들여쓰기 여부 결정. 같은 기호 반복은 새 단계를 만들지 않고 anchor를 공유.
- Backspace는 줄 맨 앞에서 상위 anchor로 한 번에 이동(반복 횟수 무관), root면 윗 줄과 병합.
- `->`, `<-`, `=>`, `<=` 자동 변환, 한글 IME(`isComposing`) 처리.
- 순수 판정 로직은 `anchorEngine.test.ts`(23개) / `arrowConvert.test.ts`(8개)로 요구사항 예시를 그대로 테스트 케이스화해서 검증. DOM 통합(contentEditable, 포커스/커서 이동) 자체는 이 샌드박스에서 실제 브라우저로 조작 테스트하지 못했으니 실행해보면서 확인 필요.

리치 텍스트(run 단위 bold/색상 UI), Highlight, Annotation 실제 연동은 Phase 4에서.

---

# React + TypeScript + Vite (템플릿 기본 안내)

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
