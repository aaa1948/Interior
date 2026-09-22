// 3D 바닥에 도면 사진을 텍스처로 깔려면 브라우저가 그 이미지를 WebGL에 올릴 수 있어야 하는데,
// 네이버 이미지 서버(phinf.pstatic.net 등)는 다른 도메인에서 오는 요청에 CORS 허용 헤더를 안 붙여줌.
// 일반 <img> 태그로 "보여주기"만 하는 건 CORS 상관없이 되지만(지금 2D 패널이 잘 뜨는 이유),
// WebGL 텍스처로 쓰려면(캔버스에서 픽셀을 읽어가는 셈이라) CORS가 없으면 브라우저가 막아버림
// ("tainted canvas"). 그래서 우리 서버가 대신 이미지를 가져와서(서버→서버 요청이라 CORS 규칙 자체가
// 적용 안 됨) 우리 도메인에서 Access-Control-Allow-Origin 헤더를 붙여 다시 내려주는 프록시.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url") || "";
  if (!/^https?:\/\//i.test(url)) {
    return new Response("bad url", { status: 400 });
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return new Response("upstream error " + upstream.status, { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response("fetch failed: " + (err instanceof Error ? err.message : String(err)), { status: 502 });
  }
}

