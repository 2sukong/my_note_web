import type { TextObject } from '../../types/object';
import { DEFAULT_FONT_FAMILY } from '../../objects/text/fontOptions';
import { LINE_HEIGHT_MAX, LINE_HEIGHT_MIN, LINE_HEIGHT_STEP, LINE_HEIGHT_DEFAULT, clampLineHeight } from '../../objects/text/lineSpacing';
import { BoldIcon, BorderToggleIcon } from '../../objects/style/StyleIcons';
import { ColorPickerPopover } from '../../objects/style/ColorPickerPopover';
import { RecentColorSwatches } from '../../objects/style/RecentColorSwatches';
import { FONT_SIZE_PRESETS } from '../../objects/text/fontSizePresets';
import {
  Row,
  Tile,
  Dropdown,
  FontPickerRow,
  NumberStepper,
} from '../PropertiesPanel';

/**
 * canvas/PropertiesPanel.tsx의 TextSection을 그대로 옮기지 않고 새로 만든 PDF 오버레이
 * 전용 버전이다 — 그대로 재사용하지 않은 이유: TextSection은 부분 서식(드래그로 선택한
 * 구간에만 스타일 적용, useTextRangeStore + useObjectsStore.setTextLines 직접 호출)
 * 분기가 있는데, PdfOverlayTextView.tsx는 애초에(v1 범위 주석 참고) 부분 서식 자체를
 * 구현하지 않았다 — 그 분기를 그대로 들여오면 존재하지 않는 기능을 흉내내다 엉뚱한
 * store(objectsStore)를 잘못 건드리게 된다. 그래서 TextSection의 "구간 선택 없음" 분기
 * (= 객체 전체에 적용하는 경로)만 추려서 새로 짰다 — update prop 하나로 usePdfOverlayStore에
 * 반영되도록 canvas/pdf/PdfOverlayPropertiesPanel.tsx가 결선한다.
 *
 * Row/Tile/Dropdown/FontPickerRow/NumberStepper는 전부 메인 캔버스와 그대로 공유한다 —
 * 별도 UI를 만들 이유가 없는 순수 프레젠테이션 조각들이다(PropertiesPanel.tsx의 export
 * 주석 참고). 팔레트(기본 제공 프리셋 5색)는 2026-09-08에 폐지되어 "자주 쓰는 색상"만
 * 색상 줄에 합쳐 보여준다 — 메인 캔버스 TextSection과 동일한 결정.
 */
export function PdfOverlayTextSection({
  object,
  update,
}: {
  object: TextObject;
  update: (patch: Partial<TextObject> & Record<string, unknown>, coalesceKey?: string) => void;
}) {
  const currentFamily = object.fontFamily || DEFAULT_FONT_FAMILY;
  const currentSize = object.baseFontSize;
  const currentColor = object.color;
  const currentBold = !!object.bold;
  const sizeOptions = FONT_SIZE_PRESETS.includes(currentSize)
    ? FONT_SIZE_PRESETS
    : [...FONT_SIZE_PRESETS, currentSize].sort((a, b) => a - b);

  return (
    <>
      <FontPickerRow currentFamily={currentFamily} onPick={(family) => update({ fontFamily: family })} />
      <Row label="줄 간격">
        <NumberStepper
          value={clampLineHeight(object.lineHeight ?? LINE_HEIGHT_DEFAULT)}
          min={LINE_HEIGHT_MIN}
          max={LINE_HEIGHT_MAX}
          step={LINE_HEIGHT_STEP}
          onChange={(next) => update({ lineHeight: next }, `line-height:${object.id}`)}
        />
      </Row>
      <Row label="크기">
        <Dropdown
          value={currentSize}
          options={sizeOptions}
          labelOf={(s) => `${s}px`}
          onChange={(s) => update({ baseFontSize: s })}
        />
      </Row>
      <Row label="색상">
        <RecentColorSwatches
          category="text"
          onPick={(color) => update({ color }, `style-color:${object.id}`)}
          activeColor={currentColor}
          swatchClassName="properties-round-swatch"
          max={4}
        />
        <ColorPickerPopover
          label="텍스트 색상"
          value={currentColor}
          onChange={(color) => update({ color }, `style-color:${object.id}`)}
          category="text"
        />
      </Row>
      <Row label="굵기">
        <Tile active={currentBold} onClick={() => update({ bold: !currentBold })} title="굵게">
          <BoldIcon />
        </Tile>
      </Row>
      <Row label="테두리">
        <Tile
          active={object.borderEnabled !== false}
          onClick={() => update({ borderEnabled: object.borderEnabled === false })}
          title={object.borderEnabled === false ? '테두리 표시' : '테두리 숨기기'}
        >
          <BorderToggleIcon enabled={object.borderEnabled !== false} />
        </Tile>
      </Row>
    </>
  );
}
