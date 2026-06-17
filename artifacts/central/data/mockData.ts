export interface DanceCategory {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  ageGroups: AgeGroup[];
  levels: string[];
  imageColor: string;
  isBallet?: boolean;
}

export type AgeGroup = "Kids" | "Teens" | "Adults";

export interface Instructor {
  id: string;
  name: string;
  title: string;
  bio: string;
  danceStyles: string[];
  rating: number;
  totalClasses: number;
  photoColor: string;
  initials: string;
  photoUrl?: string;
}

export interface DanceClass {
  id: string;
  categoryId: string;
  categoryName: string;
  instructorId: string;
  title: string;
  description: string;
  date: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  duration: string;
  location: string;
  room: string;
  price: number;
  capacity: number;
  bookedCount: number;
  level: "Beginner" | "Intermediate" | "Advanced" | "All Levels";
  ageGroup: AgeGroup;
  status: "available" | "fewSeats" | "full" | "waitingList";
  policy: string;
  featured: boolean;
  isBallet?: boolean;
}

export interface Package {
  id: string;
  title: string;
  numberOfCredits: number;
  price: number;
  validityMonths: number;
  description: string;
  isActive: boolean;
  popular?: boolean;
}

export interface BalletAssessmentSlot {
  id: string;
  date: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  availableSeats: number;
  status: "available" | "fewSeats" | "full";
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  type: "booking" | "class_reminder" | "package" | "ballet" | "offer" | "system";
  isRead: boolean;
  createdAt: string;
  timeAgo: string;
}

export const DANCE_CATEGORIES: DanceCategory[] = [
  {
    id: "c1",
    name: "Hip Hop",
    description: "Urban street dance combining rhythm, groove, and freestyle expression.",
    icon: "musical-notes",
    color: "#FF6B35",
    imageColor: "#3D1A0A",
    ageGroups: ["Kids", "Teens", "Adults"],
    levels: ["Beginner", "Intermediate", "Advanced"],
  },
  {
    id: "c2",
    name: "Afro Dance",
    description: "Energetic African-inspired dance celebrating culture, rhythm, and movement.",
    icon: "star",
    color: "#FFD400",
    imageColor: "#2D2500",
    ageGroups: ["Teens", "Adults"],
    levels: ["Beginner", "Intermediate"],
  },
  {
    id: "c3",
    name: "Breaking",
    description: "The original B-Boy/B-Girl art form — power moves, footwork, and freezes.",
    icon: "flash",
    color: "#EF4444",
    imageColor: "#2D0A0A",
    ageGroups: ["Teens", "Adults"],
    levels: ["Beginner", "Intermediate", "Advanced"],
  },
  {
    id: "c4",
    name: "Salsa",
    description: "Passionate partner dance with Cuban roots. Fun, social, and energetic.",
    icon: "heart",
    color: "#EC4899",
    imageColor: "#2D0A1A",
    ageGroups: ["Adults"],
    levels: ["Beginner", "Intermediate"],
  },
  {
    id: "c5",
    name: "Bachata",
    description: "Sensual Dominican partner dance known for its close connection and hip motion.",
    icon: "flame",
    color: "#F97316",
    imageColor: "#2D1200",
    ageGroups: ["Adults"],
    levels: ["Beginner", "Intermediate"],
  },
  {
    id: "c6",
    name: "Contemporary",
    description: "A fluid, expressive dance form blending modern and classical techniques.",
    icon: "leaf",
    color: "#22C55E",
    imageColor: "#0A1F0A",
    ageGroups: ["Teens", "Adults"],
    levels: ["Beginner", "Intermediate", "Advanced"],
  },
  {
    id: "c7",
    name: "Ballet",
    description: "Classical technique building grace, strength, and discipline. Assessment required.",
    icon: "ribbon-outline",
    color: "#00B6D6",
    imageColor: "#071418",
    ageGroups: ["Kids", "Teens", "Adults"],
    levels: ["Beginner", "Intermediate", "Advanced"],
    isBallet: true,
  },
  {
    id: "c8",
    name: "Zumba",
    description: "High-energy Latin dance fitness class. Burn calories while having a blast.",
    icon: "sunny",
    color: "#F59E0B",
    imageColor: "#2D1A00",
    ageGroups: ["Adults"],
    levels: ["Beginner"],
  },
  {
    id: "c9",
    name: "Popping",
    description: "Funk street dance using quick muscle contractions to create the 'pop' effect.",
    icon: "pulse",
    color: "#06B6D4",
    imageColor: "#001A2D",
    ageGroups: ["Teens", "Adults"],
    levels: ["Beginner", "Intermediate", "Advanced"],
  },
  {
    id: "c10",
    name: "Locking",
    description: "Groovy funk dance featuring sudden 'locks' and fluid, smooth movements.",
    icon: "lock-closed",
    color: "#8B5CF6",
    imageColor: "#1A0D2D",
    ageGroups: ["Adults"],
    levels: ["Beginner", "Intermediate"],
  },
  {
    id: "c11",
    name: "Jazz",
    description: "High-energy, expressive dance combining technique with personality and flair.",
    icon: "musical-note",
    color: "#14B8A6",
    imageColor: "#001A1A",
    ageGroups: ["Kids", "Teens", "Adults"],
    levels: ["Beginner", "Intermediate"],
  },
  {
    id: "c12",
    name: "House Dance",
    description: "NYC underground club dance born in the 80s — footwork, jacking, and freestyle.",
    icon: "home",
    color: "#3B82F6",
    imageColor: "#001020",
    ageGroups: ["Adults"],
    levels: ["Intermediate", "Advanced"],
  },
];

export const INSTRUCTORS: Instructor[] = [
  {
    id: "i1",
    name: "Amira Hassan",
    title: "Hip Hop & Afro Instructor",
    bio: "10+ years of Hip Hop and Afro dance. Performed internationally and trained at Cairo Dance Academy.",
    danceStyles: ["Hip Hop", "Afro Dance"],
    rating: 4.9,
    totalClasses: 312,
    photoColor: "#FF6B35",
    initials: "AH",
    photoUrl: "https://randomuser.me/api/portraits/women/44.jpg",
  },
  {
    id: "i2",
    name: "Karim Soliman",
    title: "Breaking Instructor",
    bio: "National Breaking champion, founder of Cairo B-Boy Crew. Expert in Popping and Locking.",
    danceStyles: ["Breaking", "Popping", "Locking"],
    rating: 4.8,
    totalClasses: 254,
    photoColor: "#EF4444",
    initials: "KS",
    photoUrl: "https://randomuser.me/api/portraits/men/32.jpg",
  },
  {
    id: "i3",
    name: "Sofia Petrova",
    title: "Ballet & Contemporary Instructor",
    bio: "Classical ballet trained in Moscow. Specialises in Contemporary and Jazz for all levels.",
    danceStyles: ["Ballet", "Contemporary", "Jazz"],
    rating: 5.0,
    totalClasses: 489,
    photoColor: "#A78BFA",
    initials: "SP",
    photoUrl: "https://randomuser.me/api/portraits/women/67.jpg",
  },
  {
    id: "i4",
    name: "Ahmed Nour",
    title: "Latin & Salsa Instructor",
    bio: "Latin dance specialist and certified Zumba instructor. Makes every class a party.",
    danceStyles: ["Salsa", "Bachata", "Zumba"],
    rating: 4.7,
    totalClasses: 198,
    photoColor: "#EC4899",
    initials: "AN",
    photoUrl: "https://randomuser.me/api/portraits/men/85.jpg",
  },
];

export const DANCE_CLASSES: DanceClass[] = [
  {
    id: "cl1",
    categoryId: "c1",
    categoryName: "Hip Hop",
    instructorId: "i1",
    title: "Hip Hop Beginners",
    description: "Learn the foundations of Hip Hop — grooves, isolations, and basic footwork in a fun, welcoming environment.",
    date: "2026-06-07",
    dayOfWeek: "Sunday",
    startTime: "6:00 PM",
    endTime: "7:30 PM",
    duration: "90 min",
    location: "Central Studio, Zamalek",
    room: "Studio A",
    price: 350,
    capacity: 20,
    bookedCount: 14,
    level: "Beginner",
    ageGroup: "Adults",
    status: "available",
    policy: "Cancellations must be made 24 hours before class for a full refund.",
    featured: true,
  },
  {
    id: "cl2",
    categoryId: "c3",
    categoryName: "Breaking",
    instructorId: "i2",
    title: "Breaking Foundations",
    description: "Master the core elements of Breaking — toprock, downrock, power moves, and freezes.",
    date: "2026-06-08",
    dayOfWeek: "Monday",
    startTime: "5:00 PM",
    endTime: "6:30 PM",
    duration: "90 min",
    location: "Central Studio, Zamalek",
    room: "Studio B",
    price: 400,
    capacity: 15,
    bookedCount: 13,
    level: "Beginner",
    ageGroup: "Teens",
    status: "fewSeats",
    policy: "Cancellations must be made 24 hours before class for a full refund.",
    featured: true,
  },
  {
    id: "cl3",
    categoryId: "c4",
    categoryName: "Salsa",
    instructorId: "i4",
    title: "Salsa Social Dance",
    description: "Partner salsa from scratch — learn to lead, follow, and shine on the social dance floor.",
    date: "2026-06-09",
    dayOfWeek: "Tuesday",
    startTime: "8:00 PM",
    endTime: "9:30 PM",
    duration: "90 min",
    location: "Central Studio, Zamalek",
    room: "Main Hall",
    price: 380,
    capacity: 24,
    bookedCount: 24,
    level: "Beginner",
    ageGroup: "Adults",
    status: "full",
    policy: "Class is full. Join the waiting list and we will notify you of any cancellations.",
    featured: false,
  },
  {
    id: "cl4",
    categoryId: "c11",
    categoryName: "Jazz",
    instructorId: "i3",
    title: "Jazz for Kids",
    description: "Introduction to jazz dance for children ages 6-12. Build coordination, rhythm, and confidence.",
    date: "2026-06-09",
    dayOfWeek: "Tuesday",
    startTime: "4:00 PM",
    endTime: "5:00 PM",
    duration: "60 min",
    location: "Central Studio, Zamalek",
    room: "Studio C",
    price: 300,
    capacity: 18,
    bookedCount: 8,
    level: "Beginner",
    ageGroup: "Kids",
    status: "available",
    policy: "Parents are welcome to observe the first session.",
    featured: true,
  },
  {
    id: "cl5",
    categoryId: "c6",
    categoryName: "Contemporary",
    instructorId: "i3",
    title: "Contemporary Intermediate",
    description: "Explore movement, space, and emotion through contemporary dance technique and improvisation.",
    date: "2026-06-10",
    dayOfWeek: "Wednesday",
    startTime: "7:00 PM",
    endTime: "8:30 PM",
    duration: "90 min",
    location: "Central Studio, Zamalek",
    room: "Studio A",
    price: 420,
    capacity: 16,
    bookedCount: 15,
    level: "Intermediate",
    ageGroup: "Adults",
    status: "fewSeats",
    policy: "Cancellations must be made 24 hours before class for a full refund.",
    featured: false,
  },
  {
    id: "cl6",
    categoryId: "c8",
    categoryName: "Zumba",
    instructorId: "i4",
    title: "Morning Zumba Fitness",
    description: "High-energy Latin fitness class. Dance your way to fitness — no experience needed!",
    date: "2026-06-10",
    dayOfWeek: "Wednesday",
    startTime: "9:00 AM",
    endTime: "10:00 AM",
    duration: "60 min",
    location: "Central Studio, Zamalek",
    room: "Main Hall",
    price: 250,
    capacity: 30,
    bookedCount: 12,
    level: "Beginner",
    ageGroup: "Adults",
    status: "available",
    policy: "Drop-in sessions welcome. No prior booking required for Zumba.",
    featured: false,
  },
  {
    id: "cl7",
    categoryId: "c2",
    categoryName: "Afro Dance",
    instructorId: "i1",
    title: "Afro Dance Energy",
    description: "Celebrate African movement traditions with high-energy, rhythmic choreography.",
    date: "2026-06-11",
    dayOfWeek: "Thursday",
    startTime: "6:30 PM",
    endTime: "8:00 PM",
    duration: "90 min",
    location: "Central Studio, Zamalek",
    room: "Studio B",
    price: 380,
    capacity: 20,
    bookedCount: 7,
    level: "Beginner",
    ageGroup: "Adults",
    status: "available",
    policy: "Cancellations must be made 24 hours before class for a full refund.",
    featured: true,
  },
  {
    id: "cl8",
    categoryId: "c9",
    categoryName: "Popping",
    instructorId: "i2",
    title: "Popping & Locking Masterclass",
    description: "Deep dive into funk styles — hits, waves, tutting, and full-body isolation techniques.",
    date: "2026-06-11",
    dayOfWeek: "Thursday",
    startTime: "4:00 PM",
    endTime: "6:00 PM",
    duration: "120 min",
    location: "Central Studio, Zamalek",
    room: "Studio B",
    price: 500,
    capacity: 12,
    bookedCount: 11,
    level: "Intermediate",
    ageGroup: "Teens",
    status: "fewSeats",
    policy: "Intermediate level required. Cancellations 24 hours prior for full refund.",
    featured: false,
  },
  {
    id: "cl9",
    categoryId: "c1",
    categoryName: "Hip Hop",
    instructorId: "i1",
    title: "Hip Hop for Kids",
    description: "Fun, age-appropriate Hip Hop for children ages 7-12. Grooves, freezes, and freestyle basics.",
    date: "2026-06-07",
    dayOfWeek: "Sunday",
    startTime: "3:00 PM",
    endTime: "4:00 PM",
    duration: "60 min",
    location: "Central Studio, Zamalek",
    room: "Studio C",
    price: 280,
    capacity: 16,
    bookedCount: 9,
    level: "Beginner",
    ageGroup: "Kids",
    status: "available",
    policy: "Parents are welcome to watch the first session.",
    featured: true,
  },
  {
    id: "cl10",
    categoryId: "c1",
    categoryName: "Hip Hop",
    instructorId: "i1",
    title: "Hip Hop Teens Crew",
    description: "Teens-only crew class focusing on choreography, musicality, and team energy.",
    date: "2026-06-08",
    dayOfWeek: "Monday",
    startTime: "7:00 PM",
    endTime: "8:30 PM",
    duration: "90 min",
    location: "Central Studio, Zamalek",
    room: "Studio A",
    price: 320,
    capacity: 18,
    bookedCount: 10,
    level: "Intermediate",
    ageGroup: "Teens",
    status: "available",
    policy: "Cancellations must be made 24 hours before class for a full refund.",
    featured: false,
  },
];

export const PACKAGES: Package[] = [
  {
    id: "pkg1",
    title: "Starter Pack",
    numberOfCredits: 4,
    price: 1200,
    validityMonths: 6,
    description: "Perfect to try out different dance styles. Use 4 credits across any class.",
    isActive: true,
  },
  {
    id: "pkg2",
    title: "Popular Pack",
    numberOfCredits: 8,
    price: 2200,
    validityMonths: 6,
    description: "Our most popular choice. Great value for regular dancers across all styles.",
    isActive: true,
    popular: true,
  },
  {
    id: "pkg3",
    title: "Pro Pack",
    numberOfCredits: 12,
    price: 3000,
    validityMonths: 6,
    description: "Maximum value for dedicated students. 12 classes, any style, 6 months.",
    isActive: true,
  },
];

export const BALLET_LEVELS = [
  "Pre-Ballet",
  "Ballet Level 1",
  "Ballet Level 2",
  "Ballet Level 3",
  "Ballet Level 4",
  "Ballet Level 5",
  "Ballet Level 6",
  "Ballet Level 7",
  "Ballet Level 8",
  "Ballet Level 9",
];

export const BALLET_PRICING = [
  {
    level: "Pre-Ballet",
    hours: "8 hours monthly",
    price: 1950,
  },
  {
    level: "Levels 1–9",
    hours: "12 hours monthly",
    price: 2650,
  },
];

export const BALLET_ASSESSMENT_SLOTS: BalletAssessmentSlot[] = [
  {
    id: "bs1",
    date: "2026-06-14",
    dayOfWeek: "Sunday",
    startTime: "10:00 AM",
    endTime: "10:30 AM",
    capacity: 4,
    bookedCount: 1,
    availableSeats: 3,
    status: "available",
  },
  {
    id: "bs2",
    date: "2026-06-14",
    dayOfWeek: "Sunday",
    startTime: "11:00 AM",
    endTime: "11:30 AM",
    capacity: 4,
    bookedCount: 3,
    availableSeats: 1,
    status: "fewSeats",
  },
  {
    id: "bs3",
    date: "2026-06-16",
    dayOfWeek: "Tuesday",
    startTime: "4:00 PM",
    endTime: "4:30 PM",
    capacity: 4,
    bookedCount: 0,
    availableSeats: 4,
    status: "available",
  },
  {
    id: "bs4",
    date: "2026-06-16",
    dayOfWeek: "Tuesday",
    startTime: "5:00 PM",
    endTime: "5:30 PM",
    capacity: 4,
    bookedCount: 2,
    availableSeats: 2,
    status: "available",
  },
  {
    id: "bs5",
    date: "2026-06-18",
    dayOfWeek: "Thursday",
    startTime: "10:00 AM",
    endTime: "10:30 AM",
    capacity: 4,
    bookedCount: 4,
    availableSeats: 0,
    status: "full",
  },
  {
    id: "bs6",
    date: "2026-06-21",
    dayOfWeek: "Sunday",
    startTime: "10:00 AM",
    endTime: "10:30 AM",
    capacity: 4,
    bookedCount: 0,
    availableSeats: 4,
    status: "available",
  },
  {
    id: "bs7",
    date: "2026-06-21",
    dayOfWeek: "Sunday",
    startTime: "11:00 AM",
    endTime: "11:30 AM",
    capacity: 4,
    bookedCount: 0,
    availableSeats: 4,
    status: "available",
  },
];

export const NOTIFICATIONS = [
  {
    id: "n1",
    title: "Booking Confirmed",
    body: "Your Hip Hop Beginners class on Sunday 6:00 PM is confirmed. See you there!",
    type: "booking" as const,
    isRead: false,
    createdAt: "2026-06-07T10:00:00",
    timeAgo: "2 hours ago",
  },
  {
    id: "n2",
    title: "Class Reminder",
    body: "Your Breaking Foundations class is tomorrow at 5:00 PM. Don't forget your sneakers!",
    type: "class_reminder" as const,
    isRead: false,
    createdAt: "2026-06-06T18:00:00",
    timeAgo: "Yesterday",
  },
  {
    id: "n3",
    title: "New Packages Available",
    body: "Check out our new class packages — save more with 4, 8, or 12-class bundles.",
    type: "package" as const,
    isRead: false,
    createdAt: "2026-06-06T09:00:00",
    timeAgo: "Yesterday",
  },
  {
    id: "n4",
    title: "Class Schedule Update",
    body: "Contemporary Intermediate on Wednesday has moved from 6:30 PM to 7:00 PM.",
    type: "system" as const,
    isRead: true,
    createdAt: "2026-06-05T14:00:00",
    timeAgo: "2 days ago",
  },
  {
    id: "n5",
    title: "Welcome to Central Studio",
    body: "You're all set! Start exploring classes and book your first session today.",
    type: "system" as const,
    isRead: true,
    createdAt: "2026-06-03T10:00:00",
    timeAgo: "4 days ago",
  },
];

export function getInstructor(id: string): Instructor | undefined {
  return INSTRUCTORS.find((i) => i.id === id);
}

export function getFeaturedClasses(): DanceClass[] {
  return DANCE_CLASSES.filter((c) => c.featured);
}

export function getClassById(id: string): DanceClass | undefined {
  return DANCE_CLASSES.find((c) => c.id === id);
}

export function getCurrentWeekClasses(): DanceClass[] {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const dayOfWeek = today.getDay();
  const daysSinceSat = (dayOfWeek + 1) % 7;
  const saturdayDate = new Date(today);
  saturdayDate.setDate(today.getDate() - daysSinceSat);
  const thursdayDate = new Date(saturdayDate);
  thursdayDate.setDate(saturdayDate.getDate() + 5);

  const satStr = saturdayDate.toISOString().slice(0, 10);
  const thuStr = thursdayDate.toISOString().slice(0, 10);

  return DANCE_CLASSES.filter((cls) => {
    if (cls.isBallet) return false;
    return cls.date >= todayStr && cls.date >= satStr && cls.date <= thuStr;
  }).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.startTime.localeCompare(b.startTime);
  });
}

export function getClassesByAgeGroup(ageGroup: AgeGroup): DanceClass[] {
  return DANCE_CLASSES.filter((c) => c.ageGroup === ageGroup && !c.isBallet);
}

export const BALLET_CATEGORY = DANCE_CATEGORIES.find((c) => c.isBallet);
