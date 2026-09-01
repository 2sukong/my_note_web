/**
 * pdfjs-dist 초기화 — 반드시 로컬 번들 worker를 쓴다(CDN 금지).
 *
 * 원칙 7(외부 API/서비스 비의존): pdfjs-dist 자체는 순수 클라이언트 라이브러리라 이 원칙과
 * 충돌하지 않지만(html-to-image/jspdf/react-colorful을 들일 때와 같은 기준), 널리 퍼진
 * 예제들이 GlobalWorkerOptions.workerSrc를 unpkg/cdnjs 같은 CDN URL로 설정하는 경우가
 * 많다 — 그렇게 하면 실제로 PDF를 파싱/렌더링할 때마다 외부 네트워크에 의존하게 되어
 * 원칙을 어기게 된다. 반드시 Vite의 `?url` import로 로컬 번들 안의 worker 파일 경로를
 * 가리키게 한다.
 *
 * 이 모듈은 부수효과(GlobalWorkerOptions.workerSrc 설정 + 아래 폴리필)만 담당한다 — PDF를
 * 다루는 다른 모듈(objects/pdf/pdfRaster.ts 등)은 이 파일을 import만 해두면(직접 쓰지
 * 않아도) 한 번만 적용된다. 여러 번 import돼도 마지막 값으로 덮어써질 뿐 안전하다(모듈은
 * 어차피 한 번만 평가되므로 실질적으로 앱 전체에서 딱 한 번만 실행된다).
 */
import { GlobalWorkerOptions } from 'pdfjs-dist';
// Vite ?url — 번들 시점에 이 워커 파일을 별도 정적 자산으로 내보내고, 그 최종 경로
// 문자열만 가져온다(워커 코드 자체를 이 모듈 번들에 인라인하지 않음). 반드시 로컬
// node_modules 안의 파일을 가리키므로 네트워크 요청 없이 항상 오프라인 동작한다.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * 폴리필(Phase 9 성능 테스트 중 발견, 2026-08): pdfjs-dist 5.7.284는 페이지를 렌더링할
 * 때마다(WorkerTransport.getOptionalContentConfig 등, 사실상 모든 render() 호출 경로)
 * `Map.prototype.getOrInsertComputed`/`WeakMap.prototype.getOrInsertComputed`를 무조건
 * 호출한다 — 이건 TC39에서 비교적 최근 정식화된 메서드(TypeScript 자체는 `es2025.collection`
 * lib로 이미 타입을 제공하지만, tsconfig.app.json의 lib가 그동안 ES2023까지만 잡혀 있었다 —
 * 이번에 "ES2025.Collection"을 같이 추가해서 아래 코드가 타입 에러 없이 컴파일된다). 문제는
 * 이 메서드를 실제로 지원하는 브라우저 엔진 버전이 아직 널리 퍼지지 않은 시점에는(구형
 * Chromium/Node 등) `render()`가 첫 페이지부터 즉시 TypeError로 실패한다 — 즉 PDF 가져오기
 * 기능 전체가 사용자의 브라우저 버전에 따라 조용히 완전히 깨질 수 있다는 뜻이다.
 *
 * 그래서 네이티브 지원이 없을 때만(feature-detect, `if (!...)`) 최소 동작을 그대로
 * 재현하는 순수 함수 폴리필을 등록해둔다 — 새 npm 의존성이 아니라 몇 줄짜리 자체 코드라
 * 원칙 7(외부 API/서비스 비의존)과 무관하다. 네이티브로 이미 있는 브라우저에서는 이 블록이
 * 아무 것도 하지 않는다(덮어쓰지 않음 — 나중에 브라우저들이 다 이 메서드를 지원하게 되면
 * 자동으로 네이티브 구현을 쓰게 된다).
 *
 * 범위 제한: 이 파일은 메인 스레드에서만 평가된다. pdfjs-dist의 실제 페이지 렌더링/파싱
 * 작업 대부분은 별도 Worker(pdf.worker.min.mjs, 위 workerSrc)에서 실행되는데, Worker는
 * 완전히 분리된 전역 스코프라 여기서 건 폴리필이 그 안까지 전파되지 않는다. 지금까지
 * 재현된 실패(WorkerTransport.getOptionalContentConfig)는 메인 스레드 쪽 코드라 이 폴리필로
 * 해결되지만, 혹시 Worker 안에서도 같은 증상(콘솔에 pdf.worker.min.mjs 쪽 스택으로 같은
 * TypeError)이 관찰되면 workerSrc 자체를 이 폴리필을 먼저 실행하고 원본을 동적 import하는
 * 작은 wrapper Blob URL로 바꿔야 한다 — 아직은 그 경로가 실제로 문제였다는 증거가 없어서
 * 미리 만들어두지 않았다(불필요한 복잡도).
 */
/** Map.prototype과 WeakMap.prototype 양쪽에 거의 같은 모양으로 붙일 폴리필이라 함수 하나로
 * 공유한다 — `has`/`get`/`set`만 있으면 동작이 동일하므로 둘 중 어느 프로토타입인지는
 * 신경 쓰지 않는다(전역 프로토타입 자체가 대상이라 인스턴스 타입을 특정할 이유도 없다). */
function polyfillGetOrInsertComputed(proto: { has: Function; get: Function; set: Function }): void {
  if (typeof (proto as { getOrInsertComputed?: unknown }).getOrInsertComputed === 'function') return;
  Object.defineProperty(proto, 'getOrInsertComputed', {
    value(this: typeof proto, key: unknown, callback: (key: unknown) => unknown) {
      if (!this.has(key)) this.set(key, callback(key));
      // has()가 true였으면 get()이 undefined를 반환할 수 없다(같은 인스턴스를 동기로
      // 다루는 한) — 그래서 그대로 반환해도 안전하다.
      return this.get(key);
    },
    writable: true,
    configurable: true,
    // enumerable 기본값(false) 유지 — 네이티브 메서드처럼 for-in/Object.keys에 안 잡히게.
  });
}
polyfillGetOrInsertComputed(Map.prototype);
polyfillGetOrInsertComputed(WeakMap.prototype);
