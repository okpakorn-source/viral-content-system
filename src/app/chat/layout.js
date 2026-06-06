import './chat.css';

export const metadata = {
  title: 'AI Content Review — ระบบตรวจงานอัจฉริยะ',
  description: 'ระบบแชทตรวจงานพนักงานด้วย AI',
};

export default function ChatLayout({ children }) {
  return (
    <div className="chat-root">
      {children}
    </div>
  );
}
