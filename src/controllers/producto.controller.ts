import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { canGestionarSucursal, isStaff } from '../middlewares/auth.js';
import { limiteProductos } from '../services/planes.service.js';

const includeProducto = {
  categorias_producto: { select: { id: true, nombre: true } },
  producto_etiquetas: { include: { etiquetas: { select: { id: true, nombre: true } } } },
  _count: { select: { producto_imagenes: true } }
};

const parseDecimal = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));
const parseBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

const buildData = (body: any) => {
  const data: any = {};
  const campos = ['nombre', 'descripcion', 'tipo', 'imagen_principal'];
  for (const c of campos) if (body[c] !== undefined) data[c] = body[c];
  if (body.precio !== undefined) data.precio = parseDecimal(body.precio);
  if (body.precio_oferta !== undefined) data.precio_oferta = body.precio_oferta === '' || body.precio_oferta === null ? null : parseDecimal(body.precio_oferta);
  if (body.stock !== undefined) data.stock = body.stock === '' || body.stock === null ? null : Number(body.stock);
  if (body.categoria_producto_id !== undefined) data.categoria_producto_id = body.categoria_producto_id === '' || body.categoria_producto_id === null ? null : Number(body.categoria_producto_id);
  if (body.destacado !== undefined) data.destacado = parseBool(body.destacado);
  if (body.disponible !== undefined) data.disponible = parseBool(body.disponible);
  if (body.activo !== undefined) data.activo = parseBool(body.activo);
  return data;
};

const verificarSucursal = async (req: Request, res: Response) => {
  const sucursalId = Number(req.params.id);
  const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId } });
  if (!sucursal) { res.status(404).json({ error: 'Sucursal no encontrada' }); return null; }
  if (!(await canGestionarSucursal(req, sucursal))) {
    res.status(403).json({ error: 'No puedes gestionar esta sucursal' }); return null;
  }
  return sucursal;
};

// GET /api/sucursales/:id/productos  (público: solo activos)
export const listPublic = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const productos = await prisma.productos_servicios.findMany({
      where: { sucursal_id: id, activo: true },
      orderBy: { fecha_creacion: 'desc' },
      include: includeProducto
    });
    res.json(productos);
  } catch (error) {
    console.error('Error listando productos:', error);
    res.status(500).json({ error: 'Error al listar productos' });
  }
};

// GET /api/sucursales/:id/productos/todos  (panel: incluye inactivos)
export const adminList = async (req: Request, res: Response) => {
  try {
    const sucursal = await verificarSucursal(req, res);
    if (!sucursal) return;
    const productos = await prisma.productos_servicios.findMany({
      where: { sucursal_id: sucursal.id },
      orderBy: { fecha_creacion: 'desc' },
      include: includeProducto
    });
    res.json(productos);
  } catch (error) {
    console.error('Error listando productos (admin):', error);
    res.status(500).json({ error: 'Error al listar productos' });
  }
};

// POST /api/sucursales/:id/productos
export const adminCreate = async (req: Request, res: Response) => {
  try {
    const sucursal = await verificarSucursal(req, res);
    if (!sucursal) return;

    const data = buildData(req.body);
    if (!data.nombre) return res.status(400).json({ error: 'nombre es requerido' });
    data.sucursal_id = sucursal.id;
    data.tipo = data.tipo ?? 'producto';
    data.precio = data.precio ?? 0;

    if (!isStaff(req)) {
      const limite = await limiteProductos(sucursal.empresa_id);
      if (limite !== null) {
        const total = await prisma.productos_servicios.count({ where: { sucursal_id: sucursal.id, activo: true } });
        if (total >= limite) {
          return res.status(403).json({
            error: `Límite de productos y servicios alcanzado (${total} de ${limite}). Actualiza tu plan para crear más.`
          });
        }
      }
    }

    const { etiqueta_ids, ...rest } = req.body;
    const etiquetas: { etiqueta_id: number }[] = Array.isArray(etiqueta_ids)
      ? [...new Set(etiqueta_ids)].map((e: any) => ({ etiqueta_id: Number(e) }))
      : [];

    const producto = await prisma.productos_servicios.create({
      data: { ...data, producto_etiquetas: etiquetas.length ? { create: etiquetas } : undefined },
      include: includeProducto
    });
    res.status(201).json(producto);
  } catch (error) {
    console.error('Error creando producto:', error);
    res.status(500).json({ error: 'Error al crear producto' });
  }
};

// PATCH /api/sucursales/:id/productos/:productoId
export const adminUpdate = async (req: Request, res: Response) => {
  try {
    const sucursal = await verificarSucursal(req, res);
    if (!sucursal) return;

    const productoId = Number(req.params.productoId);
    const producto = await prisma.productos_servicios.findFirst({
      where: { id: productoId, sucursal_id: sucursal.id }
    });
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const data = buildData(req.body);

    const { etiqueta_ids, ...rest } = req.body;
    let etiquetaOps: any;
    if (Array.isArray(etiqueta_ids)) {
      const ids = [...new Set(etiqueta_ids)].map((e: any) => Number(e));
      etiquetaOps = {
        deleteMany: {},
        create: ids.map((e) => ({ etiqueta_id: e }))
      };
    }

    const actualizado = await prisma.productos_servicios.update({
      where: { id: productoId },
      data: { ...data, ...(etiquetaOps ? { producto_etiquetas: etiquetaOps } : {}) },
      include: includeProducto
    });
    res.json(actualizado);
  } catch (error) {
    console.error('Error actualizando producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto' });
  }
};

// DELETE /api/sucursales/:id/productos/:productoId  (soft)
export const adminRemove = async (req: Request, res: Response) => {
  try {
    const sucursal = await verificarSucursal(req, res);
    if (!sucursal) return;
    const productoId = Number(req.params.productoId);
    const producto = await prisma.productos_servicios.findFirst({
      where: { id: productoId, sucursal_id: sucursal.id }
    });
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    await prisma.productos_servicios.update({ where: { id: productoId }, data: { activo: false } });
    res.json({ message: 'Producto desactivado' });
  } catch (error) {
    console.error('Error eliminando producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto' });
  }
};