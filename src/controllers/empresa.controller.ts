import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { canGestionarEmpresa, canGestionarSucursal, isStaff } from '../middlewares/auth.js';
import { contarEmpresasPorCorreo, limiteEmpresasPorCorreo } from '../services/planes.service.js';

// GET /api/empresas  (público: solo activas)
export const list = async (req: Request, res: Response) => {
  try {
    const { categoria_id, q, destacado } = req.query;
    const where: any = { activo: true };
    if (categoria_id) where.categoria_id = Number(categoria_id);
    if (q) where.nombre = { contains: String(q) };
    if (destacado === '1') where.destacado = true;

    const empresas = await prisma.empresas.findMany({
      where,
      orderBy: { fecha_creacion: 'desc' },
      include: {
        categorias_negocio: true,
        _count: { select: { sucursales: { where: { activo: true } } } }
      }
    });
    res.json(empresas);
  } catch (error) {
    console.error('Error listando empresas:', error);
    res.status(500).json({ error: 'Error al listar empresas' });
  }
};

// GET /api/empresas/mias  (autenticado: staff ve todas, dueño/empleado ve las suyas)
export const listMine = async (req: Request, res: Response) => {
  try {
    const todas = req.query.todas === '1';
    if (isStaff(req)) {
      const empresas = await prisma.empresas.findMany({
        where: todas ? {} : { activo: true },
        orderBy: { fecha_creacion: 'desc' },
        include: {
          categorias_negocio: true,
          _count: { select: { sucursales: { where: { activo: true } } } }
        }
      });
      return res.json(empresas);
    }

    const empresas = await prisma.empresas.findMany({
      where: {
        OR: [
          { usuario_empresas: { some: { usuario_id: req.user.id } } },
          { empresa_empleados: { some: { usuario_id: req.user.id } } },
          { propietario: req.user.correo }
        ],
        ...(todas ? {} : { activo: true })
      },
      orderBy: { fecha_creacion: 'desc' },
      include: {
        categorias_negocio: true,
        _count: { select: { sucursales: { where: { activo: true } } } }
      }
    });
    res.json(empresas);
  } catch (error) {
    console.error('Error listando mis empresas:', error);
    res.status(500).json({ error: 'Error al listar mis empresas' });
  }
};

// GET /api/empresas/:id  (público)
export const getById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const empresa = await prisma.empresas.findFirst({
      where: { id, activo: true },
      include: {
        categorias_negocio: true,
        sucursales: {
          where: { activo: true },
          include: { ciudades: true }
        }
      }
    });
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });
    const resultado: any = { ...empresa };
    if (req.user) {
      resultado.puedoGestionar = await canGestionarEmpresa(req, id);
      const conGestion = await Promise.all(
        (empresa.sucursales ?? []).map(async (s) => ({ ...s, puedoGestionar: await canGestionarSucursal(req, s) }))
      );
      resultado.sucursales = conGestion;
    }
    res.json(resultado);
  } catch (error) {
    console.error('Error obteniendo empresa:', error);
    res.status(500).json({ error: 'Error al obtener empresa' });
  }
};

// POST /api/empresas  (requiere permiso empresas:crear)
export const create = async (req: Request, res: Response) => {
  try {
    const {
      nombre,
      categoria_id,
      descripcion,
      logo,
      email,
      sitio_web,
      facebook,
      instagram,
      tiktok,
      propietario,
      latitud,
      longitud
    } = req.body;

    if (!nombre || !categoria_id) {
      return res.status(400).json({ error: 'nombre y categoria_id son requeridos' });
    }

    // Límite del plan: según las suscripciones activas del dueño (Gratis = 1, Básico = 2, Premium = 5, Empresarial = 10)
    if (!isStaff(req)) {
      const total = await contarEmpresasPorCorreo(req.user.correo);
      const limite = await limiteEmpresasPorCorreo(req.user.correo);
      if (limite !== null && total >= limite) {
        return res.status(403).json({
          error: `Límite de empresas alcanzado (${total} de ${limite}). Actualiza tu plan para crear más.`
        });
      }
    }

    const data: any = {
      nombre,
      categoria_id: Number(categoria_id),
      descripcion,
      logo,
      email,
      sitio_web,
      facebook,
      instagram,
      tiktok,
      latitud: latitud !== undefined && latitud !== '' ? Number(latitud) : undefined,
      longitud: longitud !== undefined && longitud !== '' ? Number(longitud) : undefined
    };
    data.propietario = isStaff(req) && propietario ? String(propietario) : req.user?.correo ?? null;

    const empresa = await prisma.empresas.create({ data });

    // Vincular al propietario como dueño de la empresa (staff con propietario o creador no staff)
    if (data.propietario) {
      const dueno = await prisma.usuarios.findFirst({ where: { correo: data.propietario } });
      if (dueno) {
        const existe = await prisma.usuario_empresas.findFirst({
          where: { usuario_id: dueno.id, empresa_id: empresa.id }
        });
        if (!existe) {
          await prisma.usuario_empresas.create({ data: { usuario_id: dueno.id, empresa_id: empresa.id } });
        }
      }
    }

    res.status(201).json(empresa);
  } catch (error) {
    console.error('Error creando empresa:', error);
    res.status(500).json({ error: 'Error al crear empresa' });
  }
};

// PATCH /api/empresas/:id  (requiere permiso empresas:editar + gestión)
export const update = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const empresa = await prisma.empresas.findUnique({ where: { id } });
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    if (!(await canGestionarEmpresa(req, id))) {
      return res.status(403).json({ error: 'No puedes gestionar esta empresa' });
    }

    const data: any = {};
    const campos = ['nombre', 'descripcion', 'logo', 'email', 'sitio_web', 'facebook', 'instagram', 'tiktok', 'categoria_id', 'latitud', 'longitud'];
    for (const campo of campos) {
      if (req.body[campo] !== undefined) {
        data[campo] =
          campo === 'categoria_id'
            ? Number(req.body[campo])
            : campo === 'latitud' || campo === 'longitud'
              ? req.body[campo] === '' || req.body[campo] === null
                ? null
                : Number(req.body[campo])
              : req.body[campo];
      }
    }

    // Campos de moderación solo para staff (admin, gerente, superadmin)
    if (isStaff(req)) {
      if (typeof req.body.verificado === 'boolean') data.verificado = req.body.verificado;
      if (typeof req.body.destacado === 'boolean') data.destacado = req.body.destacado;
      if (req.body.propietario !== undefined) data.propietario = req.body.propietario;
    }

    const updated = await prisma.empresas.update({ where: { id }, data });

    // Si se cambió el propietario, asegurar su vínculo como dueño
    if (data.propietario) {
      const dueno = await prisma.usuarios.findFirst({ where: { correo: data.propietario } });
      if (dueno) {
        const existe = await prisma.usuario_empresas.findFirst({
          where: { usuario_id: dueno.id, empresa_id: id }
        });
        if (!existe) {
          await prisma.usuario_empresas.create({ data: { usuario_id: dueno.id, empresa_id: id } });
        }
      }
    }

    res.json(updated);
  } catch (error) {
    console.error('Error actualizando empresa:', error);
    res.status(500).json({ error: 'Error al actualizar empresa' });
  }
};

// DELETE /api/empresas/:id  (requiere permiso empresas:eliminar + borrado lógico)
export const remove = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const empresa = await prisma.empresas.findUnique({ where: { id } });
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' });

    if (!(await canGestionarEmpresa(req, id))) {
      return res.status(403).json({ error: 'No puedes gestionar esta empresa' });
    }

    await prisma.$transaction([
      prisma.empresas.update({ where: { id }, data: { activo: false } }),
      prisma.sucursales.updateMany({ where: { empresa_id: id, activo: true }, data: { activo: false } })
    ]);

    res.json({ message: 'Empresa eliminada' });
  } catch (error) {
    console.error('Error eliminando empresa:', error);
    res.status(500).json({ error: 'Error al eliminar empresa' });
  }
};