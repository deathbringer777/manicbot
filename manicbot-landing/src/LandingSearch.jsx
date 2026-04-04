import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import './LandingSearch.css';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://manicbot.com';

function GeoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export default function LandingSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [salons, setSalons] = useState([]);
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const citiesFetched = useRef(false);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch autocomplete results
  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setSalons([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    fetch(`${API_BASE}/api/search/autocomplete?q=${encodeURIComponent(debouncedQuery)}`, {
      signal: controller.signal,
    })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        setSalons(data?.salons ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [debouncedQuery]);

  // Fetch popular cities (once)
  const fetchCities = useCallback(() => {
    if (citiesFetched.current) return;
    citiesFetched.current = true;
    fetch(`${API_BASE}/api/search/cities`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const list = data?.cities ?? [];
        setCities(list.slice(0, 8));
      })
      .catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = e => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleFocus = () => {
    setOpen(true);
    fetchCities();
  };

  const handleSubmit = e => {
    e.preventDefault();
    const q = query.trim();
    if (q) window.location.href = `/search?q=${encodeURIComponent(q)}`;
  };

  const handleKeyDown = e => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false);
        window.location.href = `/search?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`;
      },
      () => setLocating(false),
    );
  };

  const showDropdown = open;
  const showCities = query.length < 2;
  const showResults = !showCities && debouncedQuery.length >= 2;
  const showNoResults = showResults && !loading && salons.length === 0;

  return (
    <div className="ls-wrap" ref={containerRef}>
      <form className="ls-bar" onSubmit={handleSubmit} role="search">
        <span className="ls-search-icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          type="text"
          className="ls-input"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          aria-label={t('search.placeholder')}
        />
        {query && (
          <button
            type="button"
            className="ls-clear"
            onClick={() => {
              setQuery('');
              setSalons([]);
              inputRef.current?.focus();
            }}
            aria-label="Очистить"
          >
            ×
          </button>
        )}
        <button
          type="button"
          className={`ls-geo-btn${locating ? ' ls-geo-locating' : ''}`}
          onClick={handleGeolocate}
          title={t('search.geoButton')}
          aria-label={t('search.geoButton')}
          disabled={locating}
        >
          {locating ? <span className="ls-spinner" /> : <GeoIcon />}
        </button>
      </form>

      {showDropdown && (
        <div className="ls-dropdown" role="listbox">
          {/* Loading skeletons */}
          {loading && (
            <div className="ls-loading">
              {[1, 2, 3].map(i => (
                <div key={i} className="ls-skeleton" />
              ))}
            </div>
          )}

          {/* Popular cities (empty state) */}
          {!loading && showCities && cities.length > 0 && (
            <>
              <div className="ls-section-label">{t('search.popularCities')}</div>
              {cities.map((item, idx) => {
                const city = typeof item === 'string' ? item : item.city;
                const count = typeof item === 'object' ? item.count : null;
                return (
                  <a
                    key={city ?? idx}
                    className="ls-item"
                    href={`/search?city=${encodeURIComponent(city)}`}
                    onClick={() => setOpen(false)}
                    role="option"
                  >
                    <span className="ls-item-icon ls-city-icon">📍</span>
                    <span className="ls-item-main">{city}</span>
                    {count != null && <span className="ls-item-count">{count}</span>}
                  </a>
                );
              })}
            </>
          )}

          {/* Salon results */}
          {!loading && showResults && salons.length > 0 && (
            <>
              {salons.map(salon => (
                <a
                  key={salon.id ?? salon.slug}
                  className="ls-item"
                  href={`/salon/${salon.slug}`}
                  onClick={() => setOpen(false)}
                  role="option"
                >
                  {salon.coverPhoto ? (
                    <img src={salon.coverPhoto} alt="" className="ls-item-photo" />
                  ) : (
                    <span className="ls-item-icon">💅</span>
                  )}
                  <span className="ls-item-main">
                    {salon.name}
                    {salon.city && <span className="ls-item-city">{salon.city}</span>}
                  </span>
                  <span className="ls-item-chevron">›</span>
                </a>
              ))}
              <a
                className="ls-show-all"
                href={`/search?q=${encodeURIComponent(debouncedQuery)}`}
                onClick={() => setOpen(false)}
              >
                {t('search.showAll')} →
              </a>
            </>
          )}

          {/* No results */}
          {!loading && showNoResults && (
            <div className="ls-no-results">
              <span>{t('search.noResults')}</span>
              <a
                href={`/search?q=${encodeURIComponent(debouncedQuery)}`}
                onClick={() => setOpen(false)}
              >
                {t('search.showAll')} →
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
