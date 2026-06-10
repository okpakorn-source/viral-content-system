import "./globals.css";
import ClientLayout from "@/components/ClientLayout";

export const metadata = {
  title: "ViralFlow \u2014 \u0e23\u0e30\u0e1a\u0e1a\u0e1c\u0e25\u0e34\u0e15\u0e04\u0e2d\u0e19\u0e40\u0e17\u0e19\u0e15\u0e4c\u0e44\u0e27\u0e23\u0e31\u0e25 AI",
  description: "\u0e23\u0e30\u0e1a\u0e1a AI \u0e2a\u0e23\u0e49\u0e32\u0e07\u0e04\u0e2d\u0e19\u0e40\u0e17\u0e19\u0e15\u0e4c\u0e44\u0e27\u0e23\u0e31\u0e25\u0e2d\u0e31\u0e15\u0e42\u0e19\u0e21\u0e31\u0e15\u0e34\u0e08\u0e32\u0e01\u0e17\u0e38\u0e01\u0e41\u0e2b\u0e25\u0e48\u0e07",
};

export default function RootLayout({ children }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        {/* ★ ตั้ง theme ก่อน paint แรก — กันจอกะพริบ (FOUC). default = สว่าง */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('vf_theme');if(t!=='dark'&&t!=='light')t='light';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}