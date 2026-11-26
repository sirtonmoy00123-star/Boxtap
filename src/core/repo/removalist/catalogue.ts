// Starter volume catalogue, seeded into every new Removalist workspace (owner's REMOVALIST_MODE_BUILD.md table).
// English names and m³ values are the owner's exact ones. The Bangla names were written by Claude and are on the
// "Bangla strings for native review" list in BUILD_NOTES.md. Settings says "Starter values — adjust to your own experience".
export interface StarterItem { en: string; bn: string; m3: number; kind: 'box' | 'furniture' }

export const STARTER_CATALOGUE: readonly StarterItem[] = [
  { en: 'Standard carton', bn: 'স্ট্যান্ডার্ড কার্টন', m3: 0.10, kind: 'box' },
  { en: 'Large carton', bn: 'বড় কার্টন', m3: 0.15, kind: 'box' },
  { en: 'Wardrobe carton', bn: 'ওয়ার্ডরোব কার্টন', m3: 0.30, kind: 'box' },
  { en: '3-seater sofa', bn: '৩-সিটের সোফা', m3: 1.50, kind: 'furniture' },
  { en: '2-seater sofa', bn: '২-সিটের সোফা', m3: 1.00, kind: 'furniture' },
  { en: 'Armchair', bn: 'আর্মচেয়ার', m3: 0.60, kind: 'furniture' },
  { en: 'Queen or double bed (frame + mattress)', bn: 'কুইন বা ডাবল খাট (ফ্রেম + ম্যাট্রেস)', m3: 1.50, kind: 'furniture' },
  { en: 'Single bed', bn: 'সিঙ্গেল খাট', m3: 0.80, kind: 'furniture' },
  { en: 'Wardrobe, 2-door', bn: 'আলমারি, ২ দরজা', m3: 1.50, kind: 'furniture' },
  { en: 'Desk', bn: 'ডেস্ক', m3: 0.60, kind: 'furniture' },
  { en: 'Steel almirah (BD)', bn: 'স্টিলের আলমারি', m3: 1.00, kind: 'furniture' },
  { en: 'Fridge, large', bn: 'বড় ফ্রিজ', m3: 1.00, kind: 'furniture' },
  { en: 'Fridge, small', bn: 'ছোট ফ্রিজ', m3: 0.50, kind: 'furniture' },
  { en: 'Washing machine', bn: 'ওয়াশিং মেশিন', m3: 0.50, kind: 'furniture' },
  { en: 'Dryer', bn: 'ড্রায়ার', m3: 0.40, kind: 'furniture' },
  { en: 'TV (boxed or wrapped)', bn: 'টিভি (বাক্সে বা মোড়ানো)', m3: 0.30, kind: 'furniture' },
  { en: 'Dining table, 6-seat', bn: 'ডাইনিং টেবিল, ৬ জনের', m3: 1.00, kind: 'furniture' },
  { en: 'Dining chair', bn: 'ডাইনিং চেয়ার', m3: 0.20, kind: 'furniture' },
  { en: 'Chest of drawers', bn: 'ড্রয়ার আলমারি', m3: 0.60, kind: 'furniture' },
  { en: 'Bookshelf', bn: 'বইয়ের তাক', m3: 0.50, kind: 'furniture' },
  { en: 'Bicycle', bn: 'সাইকেল', m3: 0.40, kind: 'furniture' },
  { en: 'Showcase / display cabinet (BD)', bn: 'শোকেস', m3: 1.00, kind: 'furniture' },
];
