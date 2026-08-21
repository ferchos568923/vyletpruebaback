import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';

const selectSucursal = {
  ciudades: { select: { id: true, nombre: true } },
  empresas: { select: { id: true, nombre: true, logo: true, verificado: true, destacado: true } }
};

const armarSucursal = (s: any) => ({
  id: s.id,
  nombre: s.nombre,
  direccion: s.direccion,
  telefono: s.telefono,
  whatsapp: s.whatsapp,
  imagen_principal: s.imagen_principal,
  horario: s.horario,
  calificacion: s.calificacion,
  latitud: s.latitud,
  longitud: s.longitud,
  precio_ninos: s.precio_ninos,
  precio_adultos: s.precio_adultos,
  aforo_maximo: s.aforo_maximo,
  gratuito: s.gratuito,
  ciudad: s.ciudades?.nombre ?? null,
  empresas: s.empresas
});

// GET /api/buscar?q=palabra  (público: sucursales activas que tienen un producto, habitación o nombre que coincida)
export const buscarSucursalesPorProducto = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) {
      return res.json({ q: '', resultados: [] });
    }

    const [productos, habitaciones, sucursalesPorNombre] = await Promise.all([
      prisma.productos_servicios.findMany({
        where: {
          activo: true,
          sucursales: { activo: true, empresas: { activo: true } },
          OR: [
            { nombre: { contains: q, mode: 'insensitive' } },
            { descripcion: { contains: q, mode: 'insensitive' } }
          ]
        },
        orderBy: { nombre: 'asc' },
        include: { sucursales: { include: selectSucursal } }
      }),
      prisma.habitaciones.findMany({
        where: {
          activa: true,
          sucursales: { activo: true, empresas: { activo: true } },
          nombre: { contains: q, mode: 'insensitive' }
        },
        orderBy: { nombre: 'asc' },
        include: { sucursales: { include: selectSucursal } }
      }),
      prisma.sucursales.findMany({
        where: {
          activo: true,
          empresas: { activo: true },
          nombre: { contains: q, mode: 'insensitive' }
        },
        orderBy: { nombre: 'asc' },
        include: selectSucursal
      })
    ]);

    const porSucursal = new Map<number, any>();

    const registrar = (s: any, agrega: (e: any) => void, tipos: 'productos' | 'habitaciones') => {
      if (!s) return;
      let e = porSucursal.get(s.id);
      if (!e) {
        e = { sucursal: armarSucursal(s), productos: [], habitaciones: [] };
        porSucursal.set(s.id, e);
      }
      agrega(e[tipos]);
    };

    for (const p of productos) {
      registrar(
        p.sucursales,
        (arr) =>
          arr.push({
            id: p.id,
            nombre: p.nombre,
            descripcion: p.descripcion,
            tipo: p.tipo,
            precio: p.precio,
            precio_oferta: p.precio_oferta,
            imagen_principal: p.imagen_principal
          }),
        'productos'
      );
    }

    for (const h of habitaciones) {
      registrar(
        h.sucursales,
        (arr) =>
          arr.push({
            id: h.id,
            nombre: h.nombre,
            capacidad: h.capacidad,
            precio: h.precio,
            cantidad: h.cantidad
          }),
        'habitaciones'
      );
    }

    const coincidenPorNombre = new Set(sucursalesPorNombre.map((s) => s.id));
    for (const s of sucursalesPorNombre) {
      registrar(s, () => {}, 'habitaciones');
    }

    const resultados = Array.from(porSucursal.values())
      .filter((e) => e.productos.length > 0 || e.habitaciones.length > 0 || coincidenPorNombre.has(e.sucursal.id))
      .sort(
        (a, b) =>
          b.productos.length + b.habitaciones.length - (a.productos.length + a.habitaciones.length) ||
          a.sucursal.nombre.localeCompare(b.sucursal.nombre)
      );

    res.json({ q, resultados });
  } catch (error) {
    console.error('Error buscando:', error);
    res.status(500).json({ error: 'Error al buscar' });
  }
};