/** @type {import('next').NextConfig} */
const nextConfig = {
  // "/" 로 들어와도 주소창에 /plan3d.html 이 보이지 않도록, 리다이렉트 대신
  // 내부적으로만 plan3d.html을 내려주는 rewrite를 사용함 (URL은 그대로 "/" 유지).
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/plan3d.html" },
      ],
    };
  },
};

export default nextConfig;
