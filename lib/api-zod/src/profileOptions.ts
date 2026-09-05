import { z } from "zod";

/**
 * Canonical values used by both mobile profile forms and the API boundary.
 * Keeping these lists shared prevents spelling/casing variants from splitting
 * the same city or nationality into separate analytics buckets.
 */
export const PROFILE_CITIES = [
  "Cairo",
  "Giza",
  "New Cairo",
  "6th of October",
  "Sheikh Zayed",
  "Alexandria",
  "Mansoura",
  "Tanta",
  "Zagazig",
  "Ismailia",
  "Suez",
  "Port Said",
  "Fayoum",
  "Beni Suef",
  "Minya",
  "Assiut",
  "Sohag",
  "Qena",
  "Luxor",
  "Aswan",
  "Hurghada",
  "Sharm El Sheikh",
  "Damietta",
  "Damanhur",
  "Kafr El Sheikh",
  "Arish",
  "Marsa Matruh",
  "Other",
] as const;

export const PROFILE_NATIONALITIES = [
  "Egyptian",
  "Algerian",
  "Bahraini",
  "Emirati",
  "Iraqi",
  "Jordanian",
  "Kuwaiti",
  "Lebanese",
  "Libyan",
  "Moroccan",
  "Omani",
  "Palestinian",
  "Qatari",
  "Saudi",
  "Sudanese",
  "Syrian",
  "Tunisian",
  "Yemeni",
  "American",
  "Argentinian",
  "Australian",
  "Austrian",
  "Belgian",
  "Brazilian",
  "British",
  "Canadian",
  "Chinese",
  "Danish",
  "Dutch",
  "Ethiopian",
  "Filipino",
  "Finnish",
  "French",
  "German",
  "Greek",
  "Indian",
  "Indonesian",
  "Irish",
  "Italian",
  "Japanese",
  "Kenyan",
  "Korean",
  "Malaysian",
  "Mexican",
  "New Zealander",
  "Nigerian",
  "Norwegian",
  "Pakistani",
  "Polish",
  "Portuguese",
  "Romanian",
  "Russian",
  "South African",
  "Spanish",
  "Swedish",
  "Swiss",
  "Turkish",
  "Ukrainian",
  "Other",
] as const;

export const ProfileCitySchema = z.enum(PROFILE_CITIES, {
  message: "Please select a city from the list.",
});

export const ProfileNationalitySchema = z.enum(PROFILE_NATIONALITIES, {
  message: "Please select a nationality from the list.",
});

export type ProfileCity = z.infer<typeof ProfileCitySchema>;
export type ProfileNationality = z.infer<typeof ProfileNationalitySchema>;

