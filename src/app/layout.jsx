import { Gaegu, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/store";

// next/font downloads the font files at build time and serves them from this site, so a visitor's
// browser never contacts Google's font servers. The privacy policy relies on this: do not add a
// <link> to fonts.googleapis.com here. globals.css reads the two CSS variables below.
const sans = Noto_Sans_KR({ subsets: ["latin"], display: "swap", variable: "--font-noto" });
const hand = Gaegu({ weight: ["400", "700"], display: "swap", variable: "--font-gaegu", preload: false });

export const metadata = {
  title: "하루조각",
  description: "무심코 남긴 조각들이 모여, 그날이 그려집니다",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FAF8F4",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko" className={`${sans.variable} ${hand.variable}`}>
      <body>
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
