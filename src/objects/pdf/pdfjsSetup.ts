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
 * 이 모듈은 부수효과(GlobalWorkerOptions.workerSrc 설정)만 담당한다 — PDF를 다루는 다른
 * 모듈(objects/pdf/pdfRaster.ts 등)은 이 파일을 import만 해두면(직접 쓰지 않아도) 워커
 * 설정이 한 번 적용된다. 여러 번 import돼도 마지막 값으로 덮어써질 뿐 안전하다(모듈은
 * 어차피 한 번만 평가되므로 실질적으로 앱 전체에서 딱 한 번만 실행된다).
 */
import { GlobalWorkerOptions } from 'pdfjs-dist';
// Vite ?url — 번들 시점에 이 워커 파일을 별도 정적 자산으로 내보내고, 그 최종 경로
// 문자열만 가져온다(워커 코드 자체를 이 모듈 번들에 인라인하지 않음). 반드시 로컬
// node_modules 안의 파일을 가리키므로 네트워크 요청 없이 항상 오프라인 동작한다.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
