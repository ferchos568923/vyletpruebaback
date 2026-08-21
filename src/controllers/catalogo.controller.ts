import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';

// GET /api/categorias-negocio  (público)
export const listCategorias = async (req: Request, res: Response) => {
  try {
    const categorias = await prisma.categorias_negocio.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    });
    res.json(categorias);
  } catch (error) {
    console.error('Error listando categorías:', error);
    res.status(500).json({ error: 'Error al listar categorías' });
  }
};

// GET /api/ciudades  (público)
export const listCiudades = async (req: Request, res: Response) => {
  try {
    const ciudades = await prisma.ciudades.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' },
      include: { provincias: true }
    });
    res.json(ciudades);
  } catch (error) {
    console.error('Error listando ciudades:', error);
    res.status(500).json({ error: 'Error al listar ciudades' });
  }
};

// GET /api/etiquetas  (público)
export const listEtiquetas = async (req: Request, res: Response) => {
  try {
    const etiquetas = await prisma.etiquetas.findMany({
      orderBy: { nombre: 'asc' }
    });
    res.json(etiquetas);
  } catch (error) {
    console.error('Error listando etiquetas:', error);
    res.status(500).json({ error: 'Error al listar etiquetas' });
  }
};

// GET /api/categorias-producto  (público: solo activas)
export const listCategoriasProducto = async (req: Request, res: Response) => {
  try {
    const cats = await prisma.categorias_producto.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    });
    res.json(cats);
  } catch (error) {
    console.error('Error listando categorías de producto:', error);
    res.status(500).json({ error: 'Error al listar categorías de producto' });
  }
};

// GET /api/categorias-evento  (público: solo activas)
export const listCategoriasEvento = async (req: Request, res: Response) => {
  try {
    const cats = await prisma.categorias_evento.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    });
    res.json(cats);
  } catch (error) {
    console.error('Error listando categorías de evento:', error);
    res.status(500).json({ error: 'Error al listar categorías de evento' });
  }
};

// GET /api/servicios  (público: servicios que un negocio puede ofrecer, ej. wifi)
export const listServicios = async (_req: Request, res: Response) => {
  try {
    const servicios = await prisma.servicios.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    });
    res.json(servicios);
  } catch (error) {
    console.error('Error listando servicios:', error);
    res.status(500).json({ error: 'Error al listar servicios' });
  }
};

// GET /api/tipos-interes  (público)
export const listTiposInteres = async (_req: Request, res: Response) => {
  try {
    const tipos = await prisma.tipos_interes.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    });
    res.json(tipos);
  } catch (error) {
    console.error('Error listando tipos de interés:', error);
    res.status(500).json({ error: 'Error al listar tipos de interés' });
  }
};