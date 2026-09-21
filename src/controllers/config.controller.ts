import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';

export const getGoogleMapsKey = async (_req: Request, res: Response) => {
  try {
    const config = await prisma.configuraciones.findFirst({
      select: { google_maps_api_key: true },
    });
    res.json({ google_maps_api_key: config?.google_maps_api_key ?? null });
  } catch (e) {
    console.error('Error al obtener google_maps_api_key', e);
    res.status(500).json({ error: 'Error al obtener configuración' });
  }
};
