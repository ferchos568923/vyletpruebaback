import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';

// GET /api/notificaciones  (autenticado: mis notificaciones + contador de no leídas)
export const listarMias = async (req: Request, res: Response) => {
  try {
    const [items, noLeidas] = await Promise.all([
      prisma.notificaciones.findMany({
        where: { usuario_id: req.user.id },
        orderBy: { fecha_creacion: 'desc' },
        take: 30
      }),
      prisma.notificaciones.count({ where: { usuario_id: req.user.id, leido: false } })
    ]);
    res.json({ no_leidas: noLeidas, items });
  } catch (error) {
    console.error('Error listando notificaciones:', error);
    res.status(500).json({ error: 'Error al listar notificaciones' });
  }
};

// POST /api/notificaciones/leer-todas  (autenticado)
export const marcarTodasLeidas = async (req: Request, res: Response) => {
  try {
    const r = await prisma.notificaciones.updateMany({
      where: { usuario_id: req.user.id, leido: false },
      data: { leido: true }
    });
    res.json({ message: 'Notificaciones marcadas como leídas', actualizadas: r.count });
  } catch (error) {
    console.error('Error marcando notificaciones:', error);
    res.status(500).json({ error: 'Error al marcar notificaciones' });
  }
};
