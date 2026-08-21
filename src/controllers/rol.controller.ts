import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';

// GET /api/roles  (requiere permiso roles:listar)
export const listRoles = async (req: Request, res: Response) => {
  try {
    const roles = await prisma.roles.findMany({
      orderBy: { id: 'asc' },
      include: {
        rol_permisos: { include: { permisos: true } },
        _count: { select: { usuario_roles: true } }
      }
    });
    res.json(
      roles.map((r) => ({
        ...r,
        permisos: r.rol_permisos.map((rp) => rp.permisos),
        rol_permisos: undefined
      }))
    );
  } catch (error) {
    console.error('Error listando roles:', error);
    res.status(500).json({ error: 'Error al listar roles' });
  }
};

// GET /api/roles/permisos  (requiere permiso roles:listar)
export const listPermisos = async (req: Request, res: Response) => {
  try {
    const permisos = await prisma.permisos.findMany({ orderBy: { id: 'asc' } });
    res.json(permisos);
  } catch (error) {
    console.error('Error listando permisos:', error);
    res.status(500).json({ error: 'Error al listar permisos' });
  }
};

// POST /api/roles  (requiere permiso permisos:asignar)
export const createRole = async (req: Request, res: Response) => {
  try {
    const { nombre, descripcion, activo, permisos } = req.body;
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

    const existing = await prisma.roles.findUnique({ where: { nombre } });
    if (existing) return res.status(400).json({ error: 'El rol ya existe' });

    const role = await prisma.roles.create({
      data: {
        nombre,
        descripcion,
        activo: activo !== undefined ? Boolean(activo) : true
      }
    });

    const permisoIds = Array.isArray(permisos) ? permisos.map(Number).filter((n) => Number.isInteger(n)) : [];
    if (permisoIds.length > 0) {
      await prisma.rol_permisos.createMany({
        data: permisoIds.map((permiso_id) => ({ rol_id: role.id, permiso_id }))
      });
    }

    res.status(201).json(role);
  } catch (error) {
    console.error('Error creando rol:', error);
    res.status(500).json({ error: 'Error al crear rol' });
  }
};

// PATCH /api/roles/:id  (requiere permiso permisos:asignar)
export const updateRole = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const role = await prisma.roles.findUnique({ where: { id } });
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });

    const data: any = {};
    const campos = ['nombre', 'descripcion'];
    for (const campo of campos) {
      if (req.body[campo] !== undefined) data[campo] = req.body[campo];
    }
    if (req.body.activo !== undefined) data.activo = Boolean(req.body.activo);

    const updated = await prisma.roles.update({ where: { id }, data });
    res.json(updated);
  } catch (error) {
    console.error('Error actualizando rol:', error);
    res.status(500).json({ error: 'Error al actualizar rol' });
  }
};

// PATCH /api/roles/:id/permisos  (requiere permiso permisos:asignar)
export const assignPermisos = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const role = await prisma.roles.findUnique({ where: { id } });
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });

    const permisos: number[] = Array.isArray(req.body.permisos)
      ? (req.body.permisos as unknown[]).map((n) => Number(n)).filter((n) => Number.isInteger(n))
      : [];
    const unique = [...new Set(permisos)];

    const ops: any[] = [prisma.rol_permisos.deleteMany({ where: { rol_id: id } })];
    if (unique.length > 0) {
      ops.push(prisma.rol_permisos.createMany({ data: unique.map((permiso_id) => ({ rol_id: id, permiso_id })) }));
    }
    await prisma.$transaction(ops);

    const updated = await prisma.roles.findUnique({
      where: { id },
      include: { rol_permisos: { include: { permisos: true } } }
    });
    res.json({
      ...updated,
      permisos: updated?.rol_permisos.map((rp) => rp.permisos),
      rol_permisos: undefined
    });
  } catch (error) {
    console.error('Error asignando permisos:', error);
    res.status(500).json({ error: 'Error al asignar permisos' });
  }
};

// DELETE /api/roles/:id  (requiere permiso permisos:asignar + borrado lógico)
export const removeRole = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const role = await prisma.roles.findUnique({ where: { id } });
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });

    await prisma.roles.update({ where: { id }, data: { activo: false } });
    res.json({ message: 'Rol desactivado' });
  } catch (error) {
    console.error('Error eliminando rol:', error);
    res.status(500).json({ error: 'Error al eliminar rol' });
  }
};