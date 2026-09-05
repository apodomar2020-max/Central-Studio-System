export const CONTACT_LINK_TYPES = [
  "whatsapp",
  "phone",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "website",
  "email",
] as const;

export type ContactLinkType = (typeof CONTACT_LINK_TYPES)[number];

export type AppContactLink = {
  id: number;
  type: ContactLinkType;
  label: string;
  value: string;
  icon?: string | null;
  sortOrder: number;
  isActive: boolean;
};

const SOCIAL_TYPES = new Set<ContactLinkType>([
  "whatsapp",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "website",
]);

const SOCIAL_BASE_URLS: Partial<Record<ContactLinkType, string>> = {
  facebook: "https://facebook.com/",
  instagram: "https://instagram.com/",
  tiktok: "https://tiktok.com/@",
  youtube: "https://youtube.com/@",
};

export function isSocialContactLink(link: AppContactLink): boolean {
  return SOCIAL_TYPES.has(link.type);
}

export function isDirectContactLink(link: AppContactLink): boolean {
  return link.type === "phone" || link.type === "email";
}

function webHref(value: string, baseUrl?: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;

  const withoutHandle = trimmed.replace(/^@/, "");
  if (baseUrl && !withoutHandle.includes(".") && !withoutHandle.includes("/")) {
    return `${baseUrl}${withoutHandle}`;
  }

  return `https://${trimmed}`;
}

export function getContactHref(link: AppContactLink): string | null {
  const value = link.value.trim();
  if (!value) return null;

  if (link.type === "phone") {
    const phone = value.replace(/^tel:/i, "").replace(/[^+\d*#,;]/g, "");
    return phone.replace(/\D/g, "").length >= 5 ? `tel:${phone}` : null;
  }

  if (link.type === "email") {
    const email = value.replace(/^mailto:/i, "").trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `mailto:${email}` : null;
  }

  if (link.type === "whatsapp") {
    if (/^https?:\/\//i.test(value)) return value;
    const phone = value.replace(/\D/g, "");
    return phone.length >= 5 ? `https://wa.me/${phone}` : null;
  }

  return webHref(value, SOCIAL_BASE_URLS[link.type]);
}

export function visibleContactLinks(links: AppContactLink[]): AppContactLink[] {
  return links
    .filter((link) => link.isActive && getContactHref(link) !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}
