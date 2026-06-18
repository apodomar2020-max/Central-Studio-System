-- Migration 0015: Admin-managed Help & Support FAQ and contact links

CREATE TABLE IF NOT EXISTS app_faq_items (
  id         SERIAL PRIMARY KEY,
  question   TEXT NOT NULL,
  answer     TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_contact_links (
  id         SERIAL PRIMARY KEY,
  type       TEXT NOT NULL,
  label      TEXT NOT NULL,
  value      TEXT NOT NULL,
  icon       TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_contact_links_type_check CHECK (
    type IN ('whatsapp', 'phone', 'facebook', 'instagram', 'tiktok', 'youtube', 'website', 'email')
  )
);

INSERT INTO app_faq_items (question, answer, sort_order, is_active)
VALUES
  (
    'How can I book a class?',
    'Open the Classes tab, choose the class you want, and follow the booking flow. You need to be signed in before booking.',
    10,
    TRUE
  ),
  (
    'How can I use my package credits?',
    'After your package is activated by the studio team, eligible class attendance can use one package credit at check-in.',
    20,
    TRUE
  ),
  (
    'How do I check in at the studio?',
    'Open My Studio Pass from your profile and show the QR code to reception. The team will confirm your booking and check-in method.',
    30,
    TRUE
  ),
  (
    'How can I contact support?',
    'Use the contact buttons on this page to reach the studio by WhatsApp, phone, or social channels.',
    40,
    TRUE
  )
ON CONFLICT DO NOTHING;

INSERT INTO app_contact_links (type, label, value, icon, sort_order, is_active)
VALUES
  ('whatsapp', 'WhatsApp', '+201234567890', 'logo-whatsapp', 10, TRUE),
  ('phone', 'Call Us', '+201234567890', 'call-outline', 20, TRUE),
  ('instagram', 'Instagram', 'https://instagram.com/centralstudio.eg', 'logo-instagram', 30, TRUE),
  ('facebook', 'Facebook', 'https://facebook.com/centralstudio.eg', 'logo-facebook', 40, TRUE)
ON CONFLICT DO NOTHING;
