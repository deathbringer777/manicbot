import { useState, useEffect } from 'react';
import './Carousel.css';

export default function Carousel({ items, intervalMs = 4000 }) {
  const [index, setIndex] = useState(0);
  const n = items.length;

  useEffect(() => {
    if (n <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % n), intervalMs);
    return () => clearInterval(id);
  }, [n, intervalMs]);

  return (
    <div className="carousel">
      <div className="carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
        {items.map((item, i) => (
          <div key={i} className="carousel-slide">
            <span className="carousel-icon">{item.icon}</span>
            <p className="carousel-text">{item.text}</p>
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="carousel-dots">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`carousel-dot ${i === index ? 'active' : ''}`}
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
