import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import 'dotenv/config';

const KEY = 'AIzaSyAEeSDL0oe8DpBNK98ddD8K_Y-WqRBz0hg';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const existing = await prisma.configuraciones.findFirst();
  if (existing) {
    await prisma.configuraciones.update({
      where: { id: existing.id },
      data: { google_maps_api_key: KEY },
    });
    console.log(`Actualizado google_maps_api_key en configuraciones id=${existing.id}`);
  } else {
    await prisma.configuraciones.create({
      data: {
        nombre_app: 'Vylet',
        google_maps_api_key: KEY,
      },
    });
    console.log('Creada configuracion con google_maps_api_key');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
