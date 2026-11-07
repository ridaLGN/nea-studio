/**
 * NÉA STUDIO real price menu (transcribed from the photo of the printed menu, 2026-11).
 *
 * The photo is low resolution, so every line is imported as an INACTIVE draft ("prix à vérifier"):
 * nothing is shown or bookable on the public site until an administrator checks the price
 * in Admin → Services & prices and ticks "Bookable online".
 *
 *   npm run db:import-menu            (idempotent: re-running updates the same services by slug)
 *
 * confidence: 'ok'  = name, duration and price clearly legible
 *             'low' = at least one value is a best guess — check against the printed menu
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type Line = { name: string; min: number; price: number; max?: number; desc?: string; confidence: 'ok' | 'low' };
const MENU: { category: string; slug: string; sortOrder: number; lines: Line[] }[] = [
  {
    category: 'Onglerie', slug: 'onglerie', sortOrder: 1,
    lines: [
      { name: 'Manucure classique', min: 40, price: 100, confidence: 'ok' },
      { name: 'Manucure vernis classique', min: 50, price: 130, confidence: 'low' },
      { name: 'Manucure French vernis classique', min: 60, price: 150, confidence: 'low' },
      { name: 'Pédicure classique', min: 45, price: 150, confidence: 'low' },
      { name: 'Pédicure vernis classique', min: 50, price: 180, confidence: 'low' },
      { name: 'Pédicure French vernis classique', min: 60, price: 190, confidence: 'low' },
      { name: 'Manucure SPA', min: 75, price: 200, desc: 'Soin complet + gommage + masque + vernis classique', confidence: 'low' },
      { name: 'Pédicure SPA', min: 90, price: 250, desc: 'Soin complet + gommage + masque + vernis classique', confidence: 'low' },
      { name: 'Manucure Jo Malone', min: 90, price: 280, desc: 'Soin complet + gommage + serviettes chaudes + soin à la paraffine + vernis classique', confidence: 'low' },
      { name: 'Pédicure Jo Malone', min: 100, price: 320, desc: 'Soin complet + gommage + serviettes chaudes + soin à la paraffine + vernis classique', confidence: 'low' },
    ],
  },
  {
    category: 'Semi-permanent', slug: 'semi-permanent', sortOrder: 2,
    lines: [
      { name: 'Dépose de vernis semi-permanent', min: 30, price: 50, confidence: 'ok' },
      { name: 'Pose de vernis semi-permanent (mains ou pieds)', min: 45, price: 200, confidence: 'low' },
      { name: 'Manucure semi-permanent / French', min: 60, price: 250, max: 280, confidence: 'low' },
      { name: 'Pédicure semi-permanent / French', min: 75, price: 300, max: 350, confidence: 'low' },
      { name: 'Manucure + renforcement + semi-permanent', min: 90, price: 350, confidence: 'low' },
      { name: 'Pédicure + renforcement + semi-permanent', min: 90, price: 400, confidence: 'low' },
    ],
  },
  {
    category: 'BIAB / Gel', slug: 'biab-gel', sortOrder: 3,
    lines: [
      { name: 'Dépose BIAB', min: 30, price: 50, confidence: 'ok' },
      { name: 'Dépose gel', min: 30, price: 100, confidence: 'ok' },
      { name: 'Manucure BIAB / French', min: 105, price: 400, max: 450, confidence: 'ok' },
      { name: 'Pédicure BIAB / French', min: 120, price: 400, max: 450, confidence: 'ok' },
      { name: 'Manucure BIAB + semi-permanent', min: 120, price: 460, confidence: 'low' },
      { name: 'Pédicure BIAB + semi-permanent', min: 120, price: 450, confidence: 'low' },
      { name: 'Extensions gel / French', min: 120, price: 550, max: 600, confidence: 'low' },
    ],
  },
  {
    category: 'Faux ongles', slug: 'faux-ongles', sortOrder: 4,
    lines: [
      { name: 'Nail art (par ongle)', min: 15, price: 50, confidence: 'low' },
      { name: 'Faux ongles + vernis classique', min: 60, price: 150, confidence: 'low' },
      { name: 'Faux ongles + semi-permanent', min: 90, price: 250, confidence: 'low' },
    ],
  },
];

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

async function main() {
  // nail technicians currently configured (team members already qualified for nail services)
  const nailTeam = await prisma.employee.findMany({
    where: { isActive: true, services: { some: { service: { category: { slug: 'nails' } } } } },
    select: { id: true },
  });
  let n = 0;
  for (const c of MENU) {
    const cat = await prisma.serviceCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.category, sortOrder: c.sortOrder },
      create: { name: c.category, slug: c.slug, sortOrder: c.sortOrder },
    });
    for (const [i, l] of c.lines.entries()) {
      const slug = 'nea-' + slugify(l.name);
      const note = l.confidence === 'ok' ? 'Prix lu sur le menu — à confirmer avant activation.' : '⚠ Prix à vérifier : valeur difficile à lire sur la photo du menu.';
      const data = {
        name: l.name,
        categoryId: cat.id,
        durationMinutes: l.min,
        priceMad: new Prisma.Decimal(l.price),
        priceMaxMad: l.max ? new Prisma.Decimal(l.max) : null,
        description: [l.desc, note].filter(Boolean).join('\n'),
        sortOrder: i,
        isDemo: false,
      };
      const existing = await prisma.service.findUnique({ where: { slug } });
      if (existing) {
        // never re-deactivate a service the admin already verified & activated
        await prisma.service.update({ where: { slug }, data: existing.isActive ? { categoryId: cat.id, sortOrder: i } : data });
      } else {
        await prisma.service.create({
          data: { ...data, slug, isActive: false, employees: { create: nailTeam.map((e) => ({ employeeId: e.id })) } },
        });
      }
      n++;
    }
  }
  console.log(`Menu imported: ${n} services as inactive drafts (activate them after checking prices).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
