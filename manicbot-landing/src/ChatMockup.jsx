import { useTranslation } from 'react-i18next';
import './ChatMockup.css';

export default function ChatMockup({ messages }) {
  const { t } = useTranslation();

  return (
    <div className="chat-mockup" role="img" aria-label={t('chat.ariaLabel')}>
      <div className="chat-phone">
        <div className="chat-phone-notch" />
        <div className="chat-screen">
          <div className="chat-header">
            <span className="chat-header-dot" />
            <span className="chat-header-title">ManicBot</span>
          </div>

          <div className="chat-messages">
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.from}`}>
                <div className="chat-bubble">{m.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
