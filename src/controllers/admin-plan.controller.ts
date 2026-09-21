import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';

// GET /api/admin/planes  (configuraciones:ver)
export const listPlanes = async (_req: Request, res: Response) => {
  try {
    const planes = await prisma.planes.findMany({
      orderBy: { precio: 'asc' },
      include: { _count: { select: { suscripciones: true } } }
    });
    res.json(planes);
  } catch (error) {
    console.error('Error listando planes:', error);
    res.status(500).json({ error: 'Error al listar planes' });
  }
};

// POST /api/admin/planes  (configuraciones:editar)
export const crearPlan = async (req: Request, res: Response) => {
  try {
    const { nombre, descripcion, precio, cantidad_sucursales, cantidad_empresas, cantidad_productos, dias_duracion, destacado, activo, permite_publicidad, permite_destacados, permite_cupones, permite_reservas, permite_cartillas } = req.body ?? {};
    if (!nombre || nombre.trim() === '') return res.status(400).json({ error: 'nombre es requerido' });
    if (precio === undefined || isNaN(Number(precio)) || Number(precio) < 0) {
      return res.status(400).json({ error: 'precio debe ser un número mayor o igual a 0' });
    }
    const plan = await prisma.planes.create({
      data: {
        nombre: String(nombre).trim(),
        descripcion: descripcion != null ? String(descripcion) : null,
        precio: Number(precio),
        cantidad_sucursales: cantidad_sucursales != null ? Number(cantidad_sucursales) : null,
        cantidad_empresas: cantidad_empresas != null ? Number(cantidad_empresas) : null,
        cantidad_productos: cantidad_productos != null ? Number(cantidad_productos) : null,
        dias_duracion: dias_duracion != null ? Number(dias_duracion) : null,
        destacado: destacado === true,
        activo: activo !== false,
        permite_publicidad: permite_publicidad === true,
        permite_destacados: permite_destacados === true,
        permite_cupones: permite_cupones === true,
        permite_reservas: permite_reservas === true,
        permite_cartillas: permite_cartillas === true
      }
    });
    res.status(201).json(plan);
  } catch (error) {
    console.error('Error creando plan:', error);
    res.status(500).json({ error: 'Error al crear el plan' });
  }
};

// PATCH /api/admin/planes/:id  (configuraciones:editar)
export const editarPlan = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const existente = await prisma.planes.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Plan no encontrado' });

    const { nombre, descripcion, precio, cantidad_sucursales, cantidad_empresas, cantidad_productos, dias_duracion, destacado, activo, permite_publicidad, permite_destacados, permite_cupones, permite_reservas, permite_cartillas } = req.body ?? {};
    if (nombre !== undefined && String(nombre).trim() === '') {
      return res.status(400).json({ error: 'nombre no puede estar vacío' });
    }

    const data: any = {};
    if (nombre !== undefined) data.nombre = String(nombre).trim();
    if (descripcion !== undefined) data.descripcion = descripcion != null ? String(descripcion) : null;
    if (precio !== undefined) {
      const n = Number(precio);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: 'precio inválido' });
      data.precio = n;
    }
    if (cantidad_sucursales !== undefined) data.cantidad_sucursales = cantidad_sucursales != null ? Number(cantidad_sucursales) : null;
    if (cantidad_empresas !== undefined) data.cantidad_empresas = cantidad_empresas != null ? Number(cantidad_empresas) : null;
    if (cantidad_productos !== undefined) data.cantidad_productos = cantidad_productos != null ? Number(cantidad_productos) : null;
    if (dias_duracion !== undefined) data.dias_duracion = dias_duracion != null ? Number(dias_duracion) : null;
    if (destacado !== undefined) data.destacado = destacado === true;
    if (activo !== undefined) data.activo = activo === true;
    if (permite_publicidad !== undefined) data.permite_publicidad = permite_publicidad === true;
    if (permite_destacados !== undefined) data.permite_destacados = permite_destacados === true;
    if (permite_cupones !== undefined) data.permite_cupones = permite_cupones === true;
    if (permite_reservas !== undefined) data.permite_reservas = permite_reservas === true;
    if (permite_cartillas !== undefined) data.permite_cartillas = permite_cartillas === true;

    const plan = await prisma.planes.update({ where: { id }, data });
    res.json(plan);
  } catch (error) {
    console.error('Error editando plan:', error);
    res.status(500).json({ error: 'Error al editar el plan' });
  }
};

// DELETE /api/admin/planes/:id  (configuraciones:editar) - desactiva el plan
export const eliminarPlan = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const count = await prisma.suscripciones.count({ where: { plan_id: id } });
    if (count > 0) {
      await prisma.planes.update({ where: { id }, data: { activo: false } });
      return res.json({ message: 'Plan desactivado (tiene suscripciones asociadas).' });
    }
    await prisma.planes.delete({ where: { id } });
    res.json({ message: 'Plan eliminado.' });
  } catch (error) {
    console.error('Error eliminando plan:', error);
    res.status(500).json({ error: 'Error al eliminar el plan' });
  }
};

// GET /api/admin/suscripciones  (configuraciones:ver)
export const listSuscripciones = async (req: Request, res: Response) => {
  try {
    const { estado } = req.query;
    const where: any = {};
    if (estado) where.estado = String(estado);

    const suscripciones = await prisma.suscripciones.findMany({
      where,
      orderBy: { fecha_fin: 'desc' },
      include: {
        empresas: { select: { id: true, nombre: true, propietario: true } },
        planes: true
      }
    });
    res.json(suscripciones);
  } catch (error) {
    console.error('Error listando suscripciones:', error);
    res.status(500).json({ error: 'Error al listar suscripciones' });
  }
};

// PATCH /api/admin/suscripciones/:id  { estado }  (configuraciones:editar)
export const cambiarEstadoSuscripcion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { estado } = req.body ?? {};
    if (!['pendiente', 'activa', 'inactiva', 'cancelada'].includes(estado)) {
      return res.status(400).json({ error: 'estado inválido (pendiente, activa, inactiva o cancelada)' });
    }
    const existente = await prisma.suscripciones.findUnique({ where: { id } });
    if (!existente) return res.status(404).json({ error: 'Suscripción no encontrada' });

    const suscripcion = await prisma.$transaction(async (tx) => {
      if (estado === 'activa') {
        // Al aprobar: activar la nueva y dejar inactivas las demás de la misma cédula
        if (existente.cedula) {
          await tx.suscripciones.updateMany({
            where: { cedula: existente.cedula, estado: 'activa', id: { not: id } },
            data: { estado: 'inactiva' }
          });
        }
        // También desactivar las de la misma empresa
        if (existente.empresa_id) {
          await tx.suscripciones.updateMany({
            where: { empresa_id: existente.empresa_id, estado: 'activa', id: { not: id } },
            data: { estado: 'inactiva' }
          });
        }
        await tx.pagos.updateMany({
          where: { suscripcion_id: id, estado: 'pendiente' },
          data: { estado: 'aprobado' }
        });

        // Si el plan permite destacados, marcar destacado=true en todas las empresas del usuario
        const plan = await tx.planes.findUnique({ where: { id: existente.plan_id } });
        if (plan?.permite_destacados && existente.cedula) {
          const usuarioEmpresas = await tx.usuario_empresas.findMany({
            where: { usuarios: { cedula: existente.cedula } },
            select: { empresa_id: true }
          });
          const empresaIds = usuarioEmpresas.map((ue) => ue.empresa_id);
          if (empresaIds.length > 0) {
            await tx.empresas.updateMany({
              where: { id: { in: empresaIds } },
              data: { destacado: true }
            });
          }
        }
      }

      // Si se cancela/desactiva la suscripción, quitar destacado si no hay otro plan activo que lo permita
      if (['inactiva', 'cancelada'].includes(estado) && existente.cedula) {
        const plan = await tx.planes.findUnique({ where: { id: existente.plan_id } });
        if (plan?.permite_destacados) {
          const usuarioEmpresas = await tx.usuario_empresas.findMany({
            where: { usuarios: { cedula: existente.cedula } },
            select: { empresa_id: true }
          });
          const empresaIds = usuarioEmpresas.map((ue) => ue.empresa_id);
          if (empresaIds.length > 0) {
            // Verificar si queda alguna otra suscripción activa que permita destacados
            const otraActiva = await tx.suscripciones.findFirst({
              where: {
                cedula: existente.cedula,
                estado: 'activa',
                id: { not: id },
                planes: { permite_destacados: true }
              }
            });
            if (!otraActiva) {
              await tx.empresas.updateMany({
                where: { id: { in: empresaIds } },
                data: { destacado: false }
              });
            }
          }
        }
      }

      return tx.suscripciones.update({ where: { id }, data: { estado } });
    });

    res.json({ message: `Suscripción actualizada a "${estado}".`, suscripcion });
  } catch (error) {
    console.error('Error actualizando suscripción:', error);
    res.status(500).json({ error: 'Error al actualizar la suscripción' });
  }
};