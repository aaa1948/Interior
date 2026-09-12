// 도면 이미지 URL을 받아서 3D 벽 데이터를 만들어주는 API.
//
// 예전 버전은 "벽 좌표까지 AI(NVIDIA NIM의 무료 Gemma 4 비전 모델)한테 통째로 추정해달라"고
// 시켰는데, 복잡한 도면에서 방 개수/비율/벽 위치를 계속 틀리게 뭉뚱그리는 문제가 있었음.
//
// 그래서 하이브리드 방식으로 바꿈:
//   1) 벽 좌표 = 이미지 픽셀을 직접 분석(영상처리, wallDetect.ts)해서 뽑아냄
//      → 실제 도면 선을 그대로 읽는 거라 비율/개수/위치가 항상 정확함.
//   2) 방 이름 / 실제 가로·세로 길이(축척) = AI에게 물어봄.
//   3) 영상처리만으로는 놓치거나 잘못 잡는 것들을 AI가 먼저 짚어줘서 보정함:
//      - 두꺼운 검정 실선이 아닌 방식(빗금/해칭 패턴)으로 그려진 벽, 기둥(X자 표시) →
//        "wallPatchBoxes"로 받아서 그 영역을 흑백 이미지에 검정으로 덧칠(꽉 채움) 후 벽 감지.
//      - 문 스윙 기호, 욕조/세면대/테이블 같은 가구·설비 아이콘(직선 획이 있어서 벽으로
//        오인식될 수 있음) → "ignoreBoxes"로 받아서 그 영역을 흰색으로 지운 후 벽 감지.
// AI 호출이 실패해도(타임아웃, 키 오류 등) 보정 없이 원본 그대로 벽 감지를 진행하니 완전히
// 실패하진 않음 — 다만 보정 품질은 떨어짐.
//
// 사용하려면 .env.local의 NVIDIA_API_KEY를 채워야 함 (https://build.nvidia.com -> API Keys, 무료).
// 이 라우트는 sharp 패키지가 필요함 — package.json에 추가했으니 `npm install` 한 번 더 실행해야 함.

import sharp from "sharp";
import { detectWalls, type WallSegment } from "./wallDetect";

const VISION_SYSTEM_PROMPT = `당신은 아파트/원룸 평면도(floor plan) 이미지를 분석하는 AI입니다. 아래 네 가지를 답하세요.

1. width/depth: 이 집의 실제 가로·세로 길이를 미터(m) 단위로 추정. 도면에 치수가 적혀 있으면 활용하고,
   없으면 일반적인 국내 아파트 크기 기준으로 합리적으로 추정.
2. rooms: 라벨이 붙은 모든 공간(거실/침실/주방/욕실/드레스룸/발코니/실외기실/현관 등)의 이름과, 그 글자가
   이미지 안에서 대략 어디 있는지를 "이미지 전체를 가로 0~1(u), 세로 0~1(v)로 봤을 때의 비율 좌표"로.
   u=0 왼쪽 끝, u=1 오른쪽 끝, v=0 위쪽 끝, v=1 아래쪽 끝. 작은 발코니도 빠뜨리지 마세요.
3. wallPatchBoxes: 벽인데 두꺼운 단색 검정 실선이 아니라 다른 방식으로 그려진 부분을 전부 찾아서
   사각형 영역(바운딩박스)으로 알려주세요. 여기 해당하는 것:
   - 빗금/해칭 무늬, 점선, 회색 음영 등으로 표시된 구조벽이나 파티션
   - 작은 사각형 안에 X자(대각선 교차) 표시가 된 기둥 — 기둥은 사람이 지나다닐 수 없는 완전히 막힌
     구조물이므로 그 사각형 영역 전체를 빠짐없이 포함하세요.
   각 항목은 {"u0":숫자,"v0":숫자,"u1":숫자,"v1":숫자} (좌상단, 우하단 비율 좌표) 형태입니다.
4. ignoreBoxes: 벽이 아닌데 직선 획이 있어서 벽으로 착각되기 쉬운 그림을 찾아서 사각형 영역으로
   알려주세요. 문이 열리는 방향을 나타내는 부채꼴/호 모양 선, 욕조, 세면대, 변기, 싱크대, 가스레인지,
   식탁, 옷장 서랍 같은 가구·설비 아이콘의 직선 테두리가 여기 해당합니다. 같은 {"u0","v0","u1","v1"} 형태.

반드시 아래 JSON 형식 하나만 출력하세요. 설명 문장이나 마크다운 코드블록 기호 없이 순수 JSON만 출력합니다.

{"width":숫자,"depth":숫자,"rooms":[{"u":숫자,"v":숫자,"t":"이름"}],"wallPatchBoxes":[{"u0":숫자,"v0":숫자,"u1":숫자,"v1":숫자}],"ignoreBoxes":[{"u0":숫자,"v0":숫자,"u1":숫자,"v1":숫자}]}

이미지가 도면이 아니면 {"error":"이유"} 형식으로만 응답하세요.`;

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = trimmed;
  if (fenced) {
    candidate = fenced[1].trim();
  } else {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) candidate = trimmed.slice(start, end + 1);
  }
  candidate = candidate.replace(/,(\s*[}\]])/g, "$1");
  // rooms 항목에서 "v" 키 이름을 빼먹는 실수(예: {"u":0.5,0.3,"t":"거실"}) 방어적으로 복구
  candidate = candidate.replace(/("u"\s*:\s*-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*("t"\s*:)/g, '$1,"v":$2,$3');
  return candidate;
}

interface Box { u0: number; v0: number; u1: number; v1: number }
interface AiVisionInfo {
  width: number | null;
  depth: number | null;
  rooms: { u: number; v: number; t: string }[];
  wallPatchBoxes: Box[];
  ignoreBoxes: Box[];
}

function parseBoxes(raw: unknown): Box[] {
  if (!Array.isArray(raw)) return [];
  const out: Box[] = [];
  for (const b of raw) {
    const bb = b as Record<string, unknown>;
    if (typeof bb.u0 === "number" && typeof bb.v0 === "number" && typeof bb.u1 === "number" && typeof bb.v1 === "number") {
      out.push({
        u0: Math.min(bb.u0, bb.u1),
        u1: Math.max(bb.u0, bb.u1),
        v0: Math.min(bb.v0, bb.v1),
        v1: Math.max(bb.v0, bb.v1),
      });
    }
  }
  return out;
}

async function askAiForVisionInfo(imageUrl: string, apiKey: string): Promise<AiVisionInfo> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const nimRes = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemma-4-31b-it",
        messages: [
          { role: "system", content: VISION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "이 평면도 이미지에서 실제 크기(m), 각 방 이름·위치, 검정 실선이 아닌 벽/기둥 영역, 가구·문 아이콘 영역을 JSON으로 알려줘.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 1800,
        temperature: 0.2,
        top_p: 0.95,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    clearTimeout(timeoutId);
    if (!nimRes.ok) throw new Error(`NVIDIA NIM 요청 실패 (${nimRes.status})`);

    const data = await nimRes.json();
    const msg = data?.choices?.[0]?.message ?? {};
    const raw: string = (msg.content || msg.reasoning_content || "").toString();
    const parsed = JSON.parse(extractJson(raw));
    if (typeof parsed.error === "string") throw new Error(parsed.error);

    const rooms = Array.isArray(parsed.rooms)
      ? parsed.rooms.filter((r: unknown): r is { u: number; v: number; t: string } => {
          const rr = r as Record<string, unknown>;
          return rr && typeof rr.u === "number" && typeof rr.v === "number" && typeof rr.t === "string";
        })
      : [];

    return {
      width: typeof parsed.width === "number" ? parsed.width : null,
      depth: typeof parsed.depth === "number" ? parsed.depth : null,
      rooms,
      wallPatchBoxes: parseBoxes(parsed.wallPatchBoxes),
      ignoreBoxes: parseBoxes(parsed.ignoreBoxes),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// box(이미지 비율 0~1 좌표)가 가리키는 픽셀 영역을 grayscale 버퍼에 통째로 칠함 (value: 0=검정, 255=흰색)
function paintBox(gray: Buffer, width: number, height: number, box: Box, value: number) {
  const x0 = Math.max(0, Math.min(width - 1, Math.round(box.u0 * width)));
  const x1 = Math.max(0, Math.min(width, Math.round(box.u1 * width)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(box.v0 * height)));
  const y1 = Math.max(0, Math.min(height, Math.round(box.v1 * height)));
  for (let y = y0; y < y1; y++) {
    const rowOffset = y * width;
    for (let x = x0; x < x1; x++) gray[rowOffset + x] = value;
  }
}

const MAX_SIDE = 900; // 이 픽셀 크기로 다운스케일해서 벽 감지 (속도/정확도 균형)
const DEFAULT_WIDTH_M = 9;
const DEFAULT_DEPTH_M = 7;

export async function POST(request: Request) {
  let imageUrl = "";
  try {
    const body = await request.json();
    imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
  } catch {
    // 아래 imageUrl 검증에서 실패 처리됨
  }
  if (!/^https?:\/\//i.test(imageUrl)) {
    return Response.json({ error: "이미지 주소가 올바르지 않아요" }, { status: 400 });
  }

  // 1) 이미지 다운로드 + 흑백 픽셀 버퍼 추출
  let gray: Buffer;
  let pxWidth: number;
  let pxHeight: number;
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      return Response.json({ error: `이미지를 불러오지 못했어요 (${imgRes.status})` }, { status: 400 });
    }
    const arrayBuf = await imgRes.arrayBuffer();
    const { data, info } = await sharp(Buffer.from(arrayBuf))
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    gray = data;
    pxWidth = info.width;
    pxHeight = info.height;
  } catch (err) {
    return Response.json(
      { error: "이미지 처리 중 오류가 발생했어요: " + (err instanceof Error ? err.message : String(err)) },
      { status: 502 }
    );
  }

  // 2) AI에게 방 이름·축척과 함께 "보정 지시"(벽인데 실선이 아닌 곳 / 벽 아닌데 벽처럼 보이는 곳)를 물어봄.
  //    실패해도 아래에서 보정 없이 그대로 진행하므로 전체 실패로 이어지지 않음.
  let widthM = DEFAULT_WIDTH_M;
  let depthM = DEFAULT_DEPTH_M;
  let aiRooms: { u: number; v: number; t: string }[] = [];
  const apiKey = process.env.NVIDIA_API_KEY;
  if (apiKey) {
    try {
      const aiInfo = await askAiForVisionInfo(imageUrl, apiKey);
      if (aiInfo.width && aiInfo.width > 0) widthM = aiInfo.width;
      if (aiInfo.depth && aiInfo.depth > 0) depthM = aiInfo.depth;
      aiRooms = aiInfo.rooms;

      // 가구/문 아이콘 영역을 먼저 지우고(흰색), 그 다음 실선이 아닌 벽·기둥 영역을 칠함(검정).
      // 순서가 중요: 두 영역이 겹치면 "벽으로 확정"이 "가구라서 지움"보다 우선해야 하므로 나중에 칠함.
      for (const b of aiInfo.ignoreBoxes) paintBox(gray, pxWidth, pxHeight, b, 255);
      for (const b of aiInfo.wallPatchBoxes) paintBox(gray, pxWidth, pxHeight, b, 0);
    } catch {
      // AI 실패 — 보정 없이 원본 그대로 벽 감지 진행
    }
  }

  // 3) 벽 선분 감지 (영상처리, AI가 아님 — 위에서 보정한 이미지를 그대로 읽어서 뽑아냄)
  const detection = detectWalls(gray, pxWidth, pxHeight);
  if (detection.segments.length === 0) {
    return Response.json({ error: "이미지에서 벽 선을 찾지 못했어요. 도면 이미지가 맞는지 확인해주세요." }, { status: 422 });
  }

  const { x0, y0, x1, y1 } = detection.wallBBoxFrac;
  const bboxW = Math.max(0.001, x1 - x0);
  const bboxH = Math.max(0.001, y1 - y0);
  const roomsMeters = aiRooms.map((r) => {
    const nu = Math.min(1, Math.max(0, (r.u - x0) / bboxW));
    const nv = Math.min(1, Math.max(0, (r.v - y0) / bboxH));
    return { x: nu * widthM, y: nv * depthM, t: r.t };
  });

  const walls: [number, number, number, number][] = detection.segments.map((s: WallSegment) => [
    s.x1 * widthM,
    s.y1 * depthM,
    s.x2 * widthM,
    s.y2 * depthM,
  ]);

  return Response.json({
    width: widthM,
    depth: depthM,
    walls,
    rooms: roomsMeters,
  });
}
