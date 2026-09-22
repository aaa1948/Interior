/** @type {import('next').NextConfig} */
const nextConfig = {
  // "/" 로 들어와도 주소창에 /plan3d.html 이 안 보이고, "/gallery" 로 들어와도
  // /gallery.html 이 안 보이도록, 리다이렉트 대신 내부적으로만 해당 html을
  // 내려주는 rewrite를 사용함 (주소창은 그대로 유지됨).
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/plan3d.html" },
        { source: "/gallery", destination: "/gallery.html" },
      ],
    };
  },
};

export default nextConfig;

