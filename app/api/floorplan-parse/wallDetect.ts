// 도면 이미지의 그레이스케일 픽셀 버퍼에서 "벽 선분"을 직접 뽑아내는 영상처리 로직.
// AI(비전 모델)에게 좌표를 추정해달라고 부탁하는 대신, 실제 픽셀에 그려진 선을 그대로 읽어내기 때문에
// 방 개수·비율·벽 위치가 원본 도면과 항상 일치함(=AI가 뭉뚱그리거나 잘못 셀 여지가 없음).
//
// 원리:
// 1) 어두운(검정) 픽셀만 이진화.
// 2) 각 행(가로)에서 일정 길이 이상 이어지는 어두운 구간만 "가로 벽" 후보로 남김
//    (치수선·글자 획처럼 짧거나 얇은 건 자동으로 걸러짐).
// 3) 각 열(세로)에서 동일하게 "세로 벽" 후보를 남김.
// 4) 후보 픽셀들을 연결요소(connected component)로 묶어서 하나의 벽 선분으로 만듦.
// 5) 선분들의 끝점 중 가까운 것들을 하나로 스냅해서 모서리 틈을 메움.
// 6) 전체 벽이 차지하는 바운딩박스를 기준으로 0~1 범위로 정규화해서 반환
//    (나중에 AI가 알려준 실제 가로/세로 길이(m)를 곱하면 실제 좌표가 됨).

export interface WallSegment {
  kind: "h" | "v";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WallDetectionResult {
  segments: WallSegment[]; // 벽 전체 바운딩박스 기준 0~1 정규화 좌표
  imageWidth: number; // 감지에 사용한 (다운스케일된) 이미지 픽셀 폭
  imageHeight: number;
  // 벽 바운딩박스가 전체 이미지에서 차지하는 비율 (AI가 이미지 전체 기준 0~1 좌표로 알려준
  // 방 위치를, 같은 좌표계로 맞춰 변환할 때 사용)
  wallBBoxFrac: { x0: number; y0: number; x1: number; y1: number };
}

const DARK_THRESHOLD = 90; // 이 값보다 어두우면 "벽일 수 있는 픽셀"로 간주 (0=완전 검정, 255=흰색)
const MIN_RUN_PX = 15; // 이 길이 이상 이어져야 벽 후보 (치수선/글자 획 제거용)
const MIN_COMPONENT_SPAN_PX = 12; // 연결요소가 이 정도 길이는 돼야 실제 벽으로 인정
const MIN_COMPONENT_AREA = 15;

function buildRunMask(isDark: Uint8Array, width: number, height: number, axis: "row" | "col"): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (axis === "row") {
    for (let y = 0; y < height; y++) {
      let runStart = -1;
      for (let x = 0; x <= width; x++) {
        const dark = x < width && isDark[y * width + x] === 1;
        if (dark) {
          if (runStart === -1) runStart = x;
        } else if (runStart !== -1) {
          if (x - runStart >= MIN_RUN_PX) {
            for (let xx = runStart; xx < x; xx++) mask[y * width + xx] = 1;
          }
          runStart = -1;
        }
      }
    }
  } else {
    for (let x = 0; x < width; x++) {
      let runStart = -1;
      for (let y = 0; y <= height; y++) {
        const dark = y < height && isDark[y * width + x] === 1;
        if (dark) {
          if (runStart === -1) runStart = y;
        } else if (runStart !== -1) {
          if (y - runStart >= MIN_RUN_PX) {
            for (let yy = runStart; yy < y; yy++) mask[yy * width + x] = 1;
          }
          runStart = -1;
        }
      }
    }
  }
  return mask;
}

interface ComponentBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  area: number;
}

function connectedComponents(mask: Uint8Array, width: number, height: number): ComponentBox[] {
  const visited = new Uint8Array(width * height);
  const out: ComponentBox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || visited[start] === 1) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, area = 0;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length) {
      const idx = stack.pop() as number;
      const x = idx % width;
      const y = (idx - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0) {
        const n = idx - 1;
        if (mask[n] === 1 && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (x < width - 1) {
        const n = idx + 1;
        if (mask[n] === 1 && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (y > 0) {
        const n = idx - width;
        if (mask[n] === 1 && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
      if (y < height - 1) {
        const n = idx + width;
        if (mask[n] === 1 && !visited[n]) { visited[n] = 1; stack.push(n); }
      }
    }
    out.push({ minX, minY, maxX, maxY, area });
  }
  return out;
}

/**
 * @param gray 그레이스케일 픽셀 버퍼 (0~255, row-major, 길이 width*height)
 */
export function detectWalls(gray: Uint8Array | Buffer, width: number, height: number): WallDetectionResult {
  const isDark = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) isDark[i] = gray[i] <= DARK_THRESHOLD ? 1 : 0;

  const horizMask = buildRunMask(isDark, width, height, "row");
  const vertMask = buildRunMask(isDark, width, height, "col");

  type RawSeg = { kind: "h" | "v"; x1: number; y1: number; x2: number; y2: number };
  const rawSegments: RawSeg[] = [];

  for (const c of connectedComponents(horizMask, width, height)) {
    const w = c.maxX - c.minX;
    if (w < MIN_COMPONENT_SPAN_PX || c.area < MIN_COMPONENT_AREA) continue;
    const cy = (c.minY + c.maxY) / 2;
    rawSegments.push({ kind: "h", x1: c.minX, y1: cy, x2: c.maxX, y2: cy });
  }
  for (const c of connectedComponents(vertMask, width, height)) {
    const h = c.maxY - c.minY;
    if (h < MIN_COMPONENT_SPAN_PX || c.area < MIN_COMPONENT_AREA) continue;
    const cx = (c.minX + c.maxX) / 2;
    rawSegments.push({ kind: "v", x1: cx, y1: c.minY, x2: cx, y2: c.maxY });
  }

  if (rawSegments.length === 0) {
    return { segments: [], imageWidth: width, imageHeight: height, wallBBoxFrac: { x0: 0, y0: 0, x1: 1, y1: 1 } };
  }

  // 끝점 스냅: tol 이내 끝점들을 평균 위치로 합쳐서 모서리 틈을 메움
  const tol = Math.max(4, Math.round(0.01 * Math.max(width, height)));
  const points: { x: number; y: number }[] = [];
  for (const s of rawSegments) {
    points.push({ x: s.x1, y: s.y1 });
    points.push({ x: s.x2, y: s.y2 });
  }
  const clusterSum: { x: number; y: number; n: number }[] = [];
  const assign: number[] = [];
  for (const p of points) {
    let found = -1;
    for (let ci = 0; ci < clusterSum.length; ci++) {
      const rx = clusterSum[ci].x / clusterSum[ci].n;
      const ry = clusterSum[ci].y / clusterSum[ci].n;
      if (Math.abs(p.x - rx) <= tol && Math.abs(p.y - ry) <= tol) { found = ci; break; }
    }
    if (found === -1) {
      clusterSum.push({ x: p.x, y: p.y, n: 1 });
      assign.push(clusterSum.length - 1);
    } else {
      clusterSum[found].x += p.x;
      clusterSum[found].y += p.y;
      clusterSum[found].n += 1;
      assign.push(found);
    }
  }
  const snapped = clusterSum.map((c) => ({ x: c.x / c.n, y: c.y / c.n }));

  const segmentsPx: RawSeg[] = rawSegments.map((s, i) => {
    const p1 = snapped[assign[i * 2]];
    const p2 = snapped[assign[i * 2 + 1]];
    return { kind: s.kind, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segmentsPx) {
    minX = Math.min(minX, s.x1, s.x2);
    maxX = Math.max(maxX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxY = Math.max(maxY, s.y1, s.y2);
  }
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);

  const segments: WallSegment[] = segmentsPx.map((s) => ({
    kind: s.kind,
    x1: (s.x1 - minX) / bw,
    y1: (s.y1 - minY) / bh,
    x2: (s.x2 - minX) / bw,
    y2: (s.y2 - minY) / bh,
  }));

  return {
    segments,
    imageWidth: width,
    imageHeight: height,
    wallBBoxFrac: { x0: minX / width, y0: minY / height, x1: maxX / width, y1: maxY / height },
  };
}
