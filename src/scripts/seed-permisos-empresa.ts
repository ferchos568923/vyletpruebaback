import { prisma } from '../services/prisma.js';

const PERMISOS = [
  { nombre: 'gestionar_productos', descripcion: 'Crear y editar productos y servicios' },
  { nombre: 'gestionar_eventos', descripcion: 'Gestionar eventos de la empresa' },
  { nombre: 'gestionar_reservas', descripcion: 'Ver y administrar reservas' },
  { nombre: 'gestionar_habitaciones', descripcion: 'Administrar habitaciones' },
  { nombre: 'gestionar_cupones', descripcion: 'Crear y editar cupones' },
  { nombre: 'gestionar_publicidad', descripcion: 'Crear publicidad para la empresa' },
  { nombre: 'gestionar_resenas', descripcion: 'Moderar reseñas' },
  { nombre: 'gestionar_empleados', descripcion: 'Contratar y gestionar empleados' },
  { nombre: 'gestionar_reportes', descripcion: 'Ver reportes y estadísticas' },
  { nombre: 'gestionar_informacion', descripcion: 'Editar la información de la empresa y sucursales' }
];

async function main() {
  let creados = 0;
  for (const p of PERMISOS) {
    const existe = await prisma.permisos_empresa.findFirst({ where: { nombre: p.nombre } });
    if (!existe) {
      await prisma.permisos_empresa.create({ data: p });
      creados++;
    }
  }
  const total = await prisma.permisos_empresa.count();
  console.log(`Permisos de empresa listos. Creados: ${creados}. Total: ${total}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });