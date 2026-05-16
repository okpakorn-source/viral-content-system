import "./globals.css";

export const metadata = {
  title: "ViralFlow — ระบบผลิตคอนเทนต์ไวรัล AI",
  description: "ระบบ AI อัตโนมัติสำหรับผลิตคอนเทนต์ไวรัลคุณภาพสูง",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
