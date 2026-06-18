-- Migration 0014: Admin-managed mobile app content pages

CREATE TABLE IF NOT EXISTS app_content_pages (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  subtitle   TEXT,
  content    TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_content_pages (slug, title, subtitle, content, is_active)
VALUES
(
  'help-support',
  'Help & Support',
  'Our team is available Saturday-Thursday, 10 AM - 9 PM',
  'Need help?

WhatsApp: +20 123 456 7890
Email: support@centralstudio.eg
Location: Cairo, Egypt
Website: centralstudio.eg

Frequently Asked Questions

How do I book a class?
Go to the Classes tab, find your class, and tap Book. You need to be signed in and have an active package or pay per session.

How do packages work?
Packages give you a set number of class credits valid across all dance styles. Each class attendance uses 1 credit. Go to the Packages tab to buy one.

What happens after I purchase a package?
Your package request is submitted to our team. Once we confirm your payment, we activate your credits, usually within 24 hours.

Can I cancel a pending package request?
Yes. In the My Packages tab, find your pending request and tap Cancel Request. This removes the request before any payment is processed.

How do I cancel a booking?
You can cancel a booking up to 24 hours before the class starts. Contact us via WhatsApp for cancellations.

What is the Central Stage section?
Central Stage is our professional dancer directory. If you are a trained dancer, you can apply to be featured and get booking opportunities.

Can I join with my child?
Yes. We have Kids and Teens classes for Ballet and more. Add your child''s profile in your account settings.

How do I reset my password?
Tap Forgot Password on the login screen, enter your email, and we will send you a reset link.',
  TRUE
),
(
  'privacy-policy',
  'Privacy & Policy',
  'Last updated: June 2026',
  'Central Studio is committed to protecting your privacy. This policy explains how we collect, use, and safeguard your personal information when you use our app and services.

1. Information We Collect
We collect information you provide directly to us, such as when you create an account, book a class, or contact us for support. This may include:

* Full name, email address, and phone number
* Date of birth and gender for class recommendations
* Children''s profiles for parents booking on behalf of children
* Payment information processed securely via our payment providers
* Booking history and class attendance records

2. How We Use Your Information
We use the information we collect to process bookings, manage your account, send reminders and confirmations, personalise your experience, improve our services, comply with legal obligations, and resolve disputes.

3. Information Sharing
We do not sell, trade, or rent your personal information to third parties. We may share information with instructors, payment processors, service providers, and legal authorities when required.

4. Data Security
We take data security seriously and implement industry-standard measures to protect your information, including encryption of data in transit and at rest. No internet transmission method is 100% secure.

5. Your Rights
You may request access, correction, or deletion of your personal information, opt out of marketing communications, or lodge a complaint with the relevant authority.

6. Children''s Privacy
When parents register children under 18, we collect only the information necessary to manage class bookings and assessments. Parental consent is required for children''s profiles.

7. Cookies & Analytics
We use analytics tools to understand how users interact with the app and improve the experience. This data is collected in aggregate.

8. Changes to This Policy
We may update this Privacy Policy from time to time. We will notify you of significant changes via the app or email.

9. Contact Us
Central Studio & Stage
Zamalek, Cairo, Egypt
Email: privacy@centralstudio.eg
Phone: +20 2 XXXX XXXX',
  TRUE
)
ON CONFLICT (slug) DO NOTHING;
