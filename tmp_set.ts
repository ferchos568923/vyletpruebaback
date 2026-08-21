import { prisma } from './src/services/prisma.js'
const u = await prisma.categorias_negocio.update({ where: { id: 1 }, data: { permite_habitaciones: true } })
console.log('Hotel permite_habitaciones:', u.permite_habitaciones)
await prisma.$disconnect()