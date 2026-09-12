import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Today Housing 스타터",
  description: "네이버 부동산/다방 도면을 3D로 바꾸고 AI(Gemma)와 함께 가구를 배치하는 캡스톤 프로젝트 스타터",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
