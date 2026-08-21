import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { canGestionarSucursal } from '../middlewares/auth.js';

const usuarioSelect = {
  id: true,
  nombres: true,
  apellidos: true,
  correo: true,
  foto: true
};

// GET /api/sucursales/:id/resenas  (público)
export const listarPorSucursal = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, activo: true } });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });

    const resenas = await prisma.resenas.findMany({
      where: { sucursal_id: sucursalId },
      orderBy: { fecha_creacion: 'desc' },
      include: { usuarios: { select: usuarioSelect } }
    });
    res.json(resenas);
  } catch (error) {
    console.error('Error listando reseñas:', error);
    res.status(500).json({ error: 'Error al listar reseñas' });
  }
};

// POST /api/sucursales/:id/resenas  (autenticado; una reseña por usuario)
export const crear = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, activo: true } });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });

    const { calificacion, comentario } = req.body;
    const nota = Number(calificacion);
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ error: 'calificacion debe ser un entero entre 1 y 5' });
    }

    const existe = await prisma.resenas.findFirst({
      where: { usuario_id: req.user.id, sucursal_id: sucursalId }
    });
    if (existe) {
      return res.status(400).json({ error: 'Ya calificaste esta sucursal. Puedes editar tu reseña existente.' });
    }

    const resena = await prisma.resenas.create({
      data: {
        usuario_id: req.user.id,
        sucursal_id: sucursalId,
        calificacion: nota,
        comentario: comentario ? String(comentario) : null
      },
      include: { usuarios: { select: usuarioSelect } }
    });

    await recalcular(sucursalId);
    res.status(201).json(resena);
  } catch (error) {
    console.error('Error creando reseña:', error);
    res.status(500).json({ error: 'Error al crear reseña' });
  }
};

// PATCH /api/sucursales/:id/resenas/mia  (autenticado: editar mi reseña)
export const actualizarMia = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const { calificacion, comentario } = req.body;
    const nota = Number(calificacion);
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
      return res.status(400).json({ error: 'calificacion debe ser un entero entre 1 y 5' });
    }

    const resena = await prisma.resenas.findFirst({
      where: { usuario_id: req.user.id, sucursal_id: sucursalId }
    });
    if (!resena) return res.status(404).json({ error: 'No tienes una reseña en esta sucursal' });

    const actualizada = await prisma.resenas.update({
      where: { id: resena.id },
      data: { calificacion: nota, comentario: comentario ? String(comentario) : null },
      include: { usuarios: { select: usuarioSelect } }
    });
    await recalcular(sucursalId);
    res.json(actualizada);
  } catch (error) {
    console.error('Error actualizando reseña:', error);
    res.status(500).json({ error: 'Error al actualizar reseña' });
  }
};

// GET /api/sucursales/:id/resenas/mia  (autenticado: mi reseña)
export const obtenerMia = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const resena = await prisma.resenas.findFirst({
      where: { usuario_id: req.user.id, sucursal_id: sucursalId },
      include: { usuarios: { select: usuarioSelect } }
    });
    res.json(resena ?? null);
  } catch (error) {
    console.error('Error obteniendo mi reseña:', error);
    res.status(500).json({ error: 'Error al obtener reseña' });
  }
};

// DELETE /api/admin/resenas/:id  (staff: moderar)
export const eliminarAdmin = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const resena = await prisma.resenas.findUnique({ where: { id } });
    if (!resena) return res.status(404).json({ error: 'Reseña no encontrada' });

    await prisma.resenas.delete({ where: { id } });
    await recalcular(resena.sucursal_id);
    res.json({ message: 'Reseña eliminada' });
  } catch (error) {
    console.error('Error eliminando reseña:', error);
    res.status(500).json({ error: 'Error al eliminar reseña' });
  }
};

// GET /api/admin/resenas  (staff: listar todas)
export const listarAdmin = async (req: Request, res: Response) => {
  try {
    const resenas = await prisma.resenas.findMany({
      orderBy: { fecha_creacion: 'desc' },
      include: {
        usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true } },
        sucursales: { select: { id: true, nombre: true } }
      }
    });
    res.json(resenas);
  } catch (error) {
    console.error('Error listando reseñas (admin):', error);
    res.status(500).json({ error: 'Error al listar reseñas' });
  }
};

async function recalcular(sucursalId: number) {
  const agg = await prisma.resenas.aggregate({
    where: { sucursal_id: sucursalId },
    _avg: { calificacion: true },
    _count: { calificacion: true }
  });
  await prisma.sucursales.update({
    where: { id: sucursalId },
    data: {
      calificacion: agg._avg.calificacion ?? 0,
      total_resenas: agg._count.calificacion
    }
  });
}

// DELETE /api/sucursales/:id/resenas/mia  (autenticado: borrar mi reseña)
export const eliminarMia = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const resena = await prisma.resenas.findFirst({
      where: { usuario_id: req.user.id, sucursal_id: sucursalId }
    });
    if (!resena) return res.status(404).json({ error: 'No tienes una reseña en esta sucursal' });

    await prisma.resenas.delete({ where: { id: resena.id } });
    await recalcular(sucursalId);
    res.json({ message: 'Reseña eliminada' });
  } catch (error) {
    console.error('Error eliminando mi reseña:', error);
    res.status(500).json({ error: 'Error al eliminar reseña' });
  }
};