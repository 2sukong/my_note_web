import { getDB } from './db';
import type { FileRecord, PageRecord, PageObjectsRecord } from './db';

/**
 * Phase 8: 전체 저장 내용(File 트리 + Page + objects + 이미지)을 JSON 파일 하나로
 * 내보내고 다시 불러온다. 외부 서비스 없이 로컬 파일로만 오가는 방식(요구사항 7번)이라
 * 사용자가 직접 다른 기기/브라우저로 옮기거나 수동 백업을 남기고 싶을 때 쓴다.
 *
 * 이미지 Blob은 JSON에 그대로 담을 수 없어 base64로 인코딩한다 — 이미지가 아주
 * 많은 경우 파일 크기가 커질 수 있지만, 개인용 필기 앱 규모에서는 감수할 만하다고
 * 판단했다(별도 zip 압축 등은 하지 않음, 원칙 9번: 외부 라이브러리 의존 최소화).
 */

const BACKUP_VERSION = 1;

interface BackupImage {
  id: string;
  mimeType: string;
  dataBase64: string;
}

interface BackupPayload {
  version: number;
  exportedAt: number;
  rootFileIds: string[];
  files: FileRecord[];
  pages: PageRecord[];
  pageObjects: PageObjectsRecord[];
  images: BackupImage[];
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // "data:<mime>;base64,AAAA..." 에서 콤마 뒤 실제 base64 부분만 취한다.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

/**
 * flushActivePage는 호출부(UI)에서 fileTreeStore를 통해 먼저 실행해야 한다 — 이 모듈은
 * fileTreeStore를 import하지 않는다(fileTreeStore가 이 모듈을 쓰는 방향의 의존만 두기
 * 위해, 순환 참조를 피하려고 의도적으로 얕게 유지).
 */
export async function exportBackup(): Promise<Blob> {
  const db = await getDB();
  const [files, pages, pageObjects, images, rootFileIds] = await Promise.all([
    db.getAll('files'),
    db.getAll('pages'),
    db.getAll('pageObjects'),
    db.getAll('images'),
    db.get('meta', 'rootFileIds'),
  ]);

  const encodedImages: BackupImage[] = await Promise.all(
    images.map(async (img) => ({
      id: img.id,
      mimeType: img.mimeType,
      dataBase64: await blobToBase64(img.blob),
    })),
  );

  const payload: BackupPayload = {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    rootFileIds: (rootFileIds as string[] | undefined) ?? [],
    files,
    pages,
    pageObjects,
    images: encodedImages,
  };

  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

/**
 * 전체 저장 내용을 백업 파일 내용으로 완전히 교체한다(파괴적 복원). 호출부가 사용자에게
 * "현재 내용을 모두 덮어씁니다" 확인을 받은 뒤에만 호출해야 한다. 복원 직후에는
 * fileTreeStore/objectsStore/imageStore 등 메모리 상의 모든 캐시가 예전 상태를 들고
 * 있으므로, 가장 단순하고 안전하게 페이지를 새로고침해 모든 스토어를 처음부터
 * 다시 초기화한다.
 */
export async function importBackup(file: File): Promise<void> {
  const text = await file.text();
  let payload: BackupPayload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('올바른 백업 파일이 아닙니다.');
  }
  if (!payload || payload.version !== BACKUP_VERSION || !Array.isArray(payload.files)) {
    throw new Error('지원하지 않는 백업 파일 형식입니다.');
  }

  const db = await getDB();
  await Promise.all([
    db.clear('files'),
    db.clear('pages'),
    db.clear('pageObjects'),
    db.clear('images'),
  ]);

  for (const f of payload.files) await db.put('files', f);
  for (const p of payload.pages) await db.put('pages', p);
  for (const po of payload.pageObjects) await db.put('pageObjects', po);
  for (const img of payload.images) {
    await db.put('images', { id: img.id, mimeType: img.mimeType, blob: base64ToBlob(img.dataBase64, img.mimeType) });
  }
  await db.put('meta', payload.rootFileIds ?? [], 'rootFileIds');
  await db.delete('meta', 'lastOpenPageId');

  window.location.reload();
}
