import { prisma } from './src/services/prisma.js'
const c = await prisma.categorias_negocio.findUnique({ where: { id: 1 }, select: { nombre: true, permite_habitaciones: true } })
console.log('RESULTADO:', JSON.stringify(c))
await prisma.$disconnect()