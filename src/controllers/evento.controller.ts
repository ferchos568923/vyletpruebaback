import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';

const includeEvento = {
  ciudades: { select: { id: true, nombre: true } },
  categorias_evento: { select: { id: true, nombre: true } },
  evento_etiquetas: { select: { etiquetas: { select: { id: true, nombre: true } } } },
  _count: { select: { evento_imagenes: true } }
};

const parseFecha = (v: unknown): Date | undefined => (v === undefined || v === null || v === '' ? undefined : new Date(String(v)));
const parseDecimal = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));
const parseBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

const buildData = (body: any) => {
  const data: any = {};
  const campos = ['nombre', 'descripcion', 'lugar', 'direccion', 'imagen_principal', 'instagram_url', 'facebook_url', 'tiktok_url', 'tiketera_url', 'tiketera_plataforma', 'email_contacto', 'whatsapp_contacto', 'sitio_web'];
  for (const c of campos) if (body[c] !== undefined) data[c] = body[c];
  if (body.ciudad_id !== undefined) data.ciudad_id = Number(body.ciudad_id);
  if (body.categoria_evento_id !== undefined) data.categoria_evento_id = body.categoria_evento_id === '' || body.categoria_evento_id === null ? null : Number(body.categoria_evento_id);
  if (body.fecha_inicio !== undefined) data.fecha_inicio = parseFecha(body.fecha_inicio);
  if (body.fecha_fin !== undefined) data.fecha_fin = body.fecha_fin === '' || body.fecha_fin === null ? null : parseFecha(body.fecha_fin);
  if (body.precio_desde !== undefined) data.precio_desde = parseDecimal(body.precio_desde);
  if (body.capacidad !== undefined) data.capacidad = body.capacidad === '' || body.capacidad === null ? null : Number(body.capacidad);
  if (body.latitud !== undefined) data.latitud = body.latitud === '' || body.latitud === null ? null : parseDecimal(body.latitud);
  if (body.longitud !== undefined) data.longitud = body.longitud === '' || body.longitud === null ? null : parseDecimal(body.longitud);
  if (body.destacado !== undefined) data.destacado = parseBool(body.destacado);
  if (body.banner_principal !== undefined) data.banner_principal = parseBool(body.banner_principal);
  if (body.banner_fecha_inicio !== undefined) data.banner_fecha_inicio = parseFecha(body.banner_fecha_inicio);
  if (body.banner_fecha_fin !== undefined) data.banner_fecha_fin = parseFecha(body.banner_fecha_fin);
  if (body.activo !== undefined) data.activo = parseBool(body.activo);
  return data;
};

// GET /api/eventos  (público)
export const listPublic = async (req: Request, res: Response) => {
  try {
    const { ciudad_id, categoria_evento_id, q, destacado } = req.query;
    const where: any = { activo: true };
    if (ciudad_id) where.ciudad_id = Number(ciudad_id);
    if (categoria_evento_id) where.categoria_evento_id = Number(categoria_evento_id);
    if (q) where.nombre = { contains: String(q) };
    if (destacado === '1') where.destacado = true;

    const eventos = await prisma.eventos.findMany({
      where,
      orderBy: { fecha_inicio: 'asc' },
      include: includeEvento
    });
    res.json(eventos);
  } catch (error) {
    console.error('Error listando eventos:', error);
    res.status(500).json({ error: 'Error al listar eventos' });
  }
};

// GET /api/eventos/banner (público: eventos para el carousel principal)
export const listBanner = async (req: Request, res: Response) => {
  try {
    const ahora = new Date();
    const eventos = await prisma.eventos.findMany({
      where: {
        activo: true,
        banner_principal: true,
        banner_fecha_inicio: { not: null, lte: ahora },
        OR: [
          { banner_fecha_fin: null },
          { banner_fecha_fin: { gte: ahora } },
        ],
      },
      orderBy: { banner_fecha_inicio: 'asc' },
      take: 5,
      include: includeEvento,
    });
    res.json(eventos);
  } catch (error) {
    console.error('Error listando eventos banner:', error);
    res.status(500).json({ error: 'Error al listar eventos banner' });
  }
};

// GET /api/eventos/:id  (público)
export const getById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const evento = await prisma.eventos.findFirst({
      where: { id, activo: true },
      include: { ...includeEvento, evento_imagenes: true }
    });
    if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(evento);
  } catch (error) {
    console.error('Error obteniendo evento:', error);
    res.status(500).json({ error: 'Error al obtener evento' });
  }
};

// GET /api/admin/eventos  (admin: todos)
export const adminList = async (req: Request, res: Response) => {
  try {
    const eventos = await prisma.eventos.findMany({
      orderBy: { fecha_inicio: 'desc' },
      include: includeEvento
    });
    res.json(eventos);
  } catch (error) {
    console.error('Error listando eventos (admin):', error);
    res.status(500).json({ error: 'Error al listar eventos' });
  }
};

// POST /api/admin/eventos
export const adminCreate = async (req: Request, res: Response) => {
  try {
    const { etiqueta_ids, ...bodyData } = req.body;
    const data = buildData(bodyData);
    if (!data.nombre || !data.ciudad_id || !data.fecha_inicio) {
      return res.status(400).json({ error: 'nombre, ciudad_id y fecha_inicio son requeridos' });
    }
    const evento = await prisma.eventos.create({
      data: {
        ...data,
        ...(Array.isArray(etiqueta_ids) && etiqueta_ids.length > 0 ? {
          evento_etiquetas: {
            create: etiqueta_ids.map((etiqueta_id: number) => ({ etiqueta_id })),
          },
        } : {}),
      },
      include: includeEvento,
    });
    res.status(201).json(evento);
  } catch (error) {
    console.error('Error creando evento:', error);
    res.status(500).json({ error: 'Error al crear evento' });
  }
};

// PATCH /api/admin/eventos/:id
export const adminUpdate = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existe = await prisma.eventos.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Evento no encontrado' });
    const { etiqueta_ids, ...bodyData } = req.body;
    const data = buildData(bodyData);
    // Si se envían etiquetas, eliminar las anteriores y crear las nuevas
    if (Array.isArray(etiqueta_ids)) {
      await prisma.evento_etiquetas.deleteMany({ where: { evento_id: id } });
      if (etiqueta_ids.length > 0) {
        await prisma.evento_etiquetas.createMany({
          data: etiqueta_ids.map((etiqueta_id: number) => ({ evento_id: id, etiqueta_id })),
        });
      }
    }
    const evento = await prisma.eventos.update({ where: { id }, data, include: includeEvento });
    res.json(evento);
  } catch (error) {
    console.error('Error actualizando evento:', error);
    res.status(500).json({ error: 'Error al actualizar evento' });
  }
};

// DELETE /api/admin/eventos/:id  (soft)
export const adminRemove = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existe = await prisma.eventos.findUnique({ where: { id } });
    if (!existe) return res.status(404).json({ error: 'Evento no encontrado' });
    await prisma.eventos.update({ where: { id }, data: { activo: false } });
    res.json({ message: 'Evento desactivado' });
  } catch (error) {
    console.error('Error eliminando evento:', error);
    res.status(500).json({ error: 'Error al eliminar evento' });
  }
};