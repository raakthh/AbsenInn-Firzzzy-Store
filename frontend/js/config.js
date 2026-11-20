/* =========================================================
   AbsenInn — Frontend configuration
   Only PUBLIC values belong here. Never put the Supabase
   Service Role Key or any secret in frontend code.
   ========================================================= */
window.APP_CONFIG = {
  APP_NAME: 'AbsenInn',
  TAGLINE: 'Kerja Lebih Teratur, Tim Lebih Produktif.',
  DESCRIPTOR: 'SMART EMPLOYEE MANAGEMENT',

  /* 'demo'       → runs entirely in the browser with fictitious data (localStorage).
     'production' → login via Supabase Auth; all app data via the Django REST API,
                    which verifies the Supabase JWT on every request. */
  MODE: 'demo',

  /* Supabase → Project Settings → API. These two values are PUBLIC by design
     (protected by RLS). NEVER put the service_role key here. */
  SUPABASE_URL: '',          // e.g. 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: '',     // the "anon" / "publishable" key

  /* Django REST API. '/api' = same origin (Django serves the frontend: SERVE_FRONTEND=True).
     If the frontend is hosted separately (Netlify/Vercel/GitHub Pages), use the full URL,
     e.g. 'https://absenninn-api.onrender.com/api', and add the frontend origin to CORS_ALLOWED_ORIGINS. */
  API_BASE_URL: '/api',

  LOCALE: 'id-ID',
  CURRENCY: 'IDR',
  TIMEZONE: 'Asia/Jakarta',

  /* Simulated network latency in demo mode (ms) so loading states are visible. */
  DEMO_LATENCY: 220,
  DEMO_STORAGE_KEY: 'absenninn_demo_v1',
  SESSION_KEY: 'absenninn_session',
};
