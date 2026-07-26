// Layout เฉพาะแอพมือถือ /m — ทำให้ "เพิ่มไปหน้าจอโฮม" ได้แอพเต็มตัว (ชื่อ/แถบสถานะ/สีของตัวเอง)
export const metadata = {
  title: 'ViralFlow',
  description: 'โต๊ะข่าวในกระเป๋า — ทีม IG.dara',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'ViralFlow' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F5F7' },
    { media: '(prefers-color-scheme: dark)', color: '#0D0E13' },
  ],
};

export default function MLayout({ children }) {
  return children;
}
