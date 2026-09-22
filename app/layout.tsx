import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = "https://today-housing.vercel.app";

export const metadata: Metadata = {
  title: "오늘의 하우징",
  description: "네이버 부동산/다방 도면을 3D로 바꾸고 AI(Gemma)와 함께 가구를 배치하는 캡스톤 프로젝트",
  openGraph: {
    type: "website",
    siteName: "오늘의 하우징",
    title: "오늘의 하우징 — 도면 한 장으로 시작하는 3D 인테리어",
    description: "네이버 부동산·다방 도면을 3D 벽 모델로 바꾸고, 무료 AI와 함께 가구를 배치한 뒤 다른 사람들에게 의견을 받아보세요.",
    url: SITE_URL,
    locale: "ko_KR",
    images: [{ url: `${SITE_URL}/og-image.png`, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "오늘의 하우징 — 도면 한 장으로 시작하는 3D 인테리어",
    description: "네이버 부동산·다방 도면을 3D 벽 모델로 바꾸고, 무료 AI와 함께 가구를 배치한 뒤 다른 사람들에게 의견을 받아보세요.",
    images: [`${SITE_URL}/og-image.png`],
  },
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

