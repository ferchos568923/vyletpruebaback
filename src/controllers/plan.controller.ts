import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { canGestionarEmpresa } from '../middlewares/auth.js';
import {
  limiteSucursales,
  suscripcionActiva,
  DIAS_DEFAULT_SUSCRIPCION,
  contarEmpresasPorCorreo,
  limiteEmpresasPorCorreo,
  limiteProductos,
  permiteCupones,
  permiteReservas
} from '../services/planes.service.js';

// GET /api/empresas/:id/plan  (autenticado + gestión): plan actual de la empresa
export const obtenerPlan = async (req: Request, res: Response) => {
  try {
    const empresaId = Number(req.params.id);
    if (!(await canGestionarEmpresa(req, empresaId))) {
      return res.status(403).json({ error: 'No puedes gestionar esta empresa' });
    }

    const [planes, suscripcion, pendiente, cantSucursales, limite, limiteProd, conCupones, conReservas] = await Promise.all([
      prisma.planes.findMany({ where: { activo: true }, orderBy: { precio: 'asc' } }),
      suscripcionActiva(empresaId),
      prisma.suscripciones.findFirst({
        where: { empresa_id: empresaId, estado: 'pendiente' },
        orderBy: { fecha_fin: 'desc' },
        include: { planes: true }
      }),
      prisma.sucursales.count({ where: { empresa_id: empresaId, activo: true } }),
      limiteSucursales(empresaId),
      limiteProductos(empresaId),
      permiteCupones(empresaId),
      permiteReservas(empresaId)
    ]);

    const empresa = await prisma.empresas.findUnique({ where: { id: empresaId }, select: { propietario: true } });
    const propietario = empresa?.propietario ?? '';
    const cantEmpresas = propietario ? await contarEmpresasPorCorreo(propietario) : 0;
    const limiteEmpresas = propietario ? await limiteEmpresasPorCorreo(propietario) : null;

    const cantProductos = await prisma.productos_servicios.count({
      where: { activo: true, sucursales: { empresa_id: empresaId } }
    });

    res.json({
      planes,
      suscripcion,
      plan_actual: suscripcion?.planes ?? null,
      solicitud_pendiente: pendiente?.planes ?? null,
      cant_sucursales: cantSucursales,
      limite_sucursales: limite,
      libre: limite === null ? Infinity : Math.max(0, limite - cantSucursales),
      cant_empresas: cantEmpresas,
      limite_empresas: limiteEmpresas,
      cant_productos: cantProductos,
      limite_productos: limiteProd,
      libre_productos: limiteProd === null ? Infinity : Math.max(0, limiteProd - cantProductos),
      permite_cupones: conCupones,
      permite_reservas: conReservas
    });
  } catch (error) {
    console.error('Error obteniendo plan:', error);
    res.status(500).json({ error: 'Error al obtener el plan' });
  }
};

// POST /api/empresas/:id/plan  { plan_id } (autenticado + gestión): solicitar plan (queda pendiente de aprobación del admin)
export const activarPlan = async (req: Request, res: Response) => {
  try {
    const empresaId = Number(req.params.id);
    if (!(await canGestionarEmpresa(req, empresaId))) {
      return res.status(403).json({ error: 'No puedes gestionar esta empresa' });
    }

    const planId = Number(req.body?.plan_id);
    const plan = await prisma.planes.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
    if (plan.activo === false) return res.status(400).json({ error: 'El plan no está activo' });

    const ahora = new Date();
    const dias = plan.dias_duracion ?? DIAS_DEFAULT_SUSCRIPCION;
    const fechaFin = new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000);

    // La suscripción queda PENDIENTE hasta que el admin la apruebe
    const suscripcion = await prisma.$transaction(async (tx) => {
      await tx.suscripciones.updateMany({
        where: { empresa_id: empresaId, estado: 'pendiente' },
        data: { estado: 'inactiva' }
      });
      const creada = await tx.suscripciones.create({
        data: {
          empresa_id: empresaId,
          plan_id: plan.id,
          fecha_inicio: ahora,
          fecha_fin: fechaFin,
          estado: 'pendiente'
        }
      });
      await tx.pagos.create({
        data: {
          empresa_id: empresaId,
          suscripcion_id: creada.id,
          monto: plan.precio,
          metodo_pago: 'simulacion',
          estado: 'pendiente'
        }
      });
      return creada;
    });

    res.status(201).json({
      message: `Solicitud del plan ${plan.nombre} enviada. El administrador la revisará.`,
      suscripcion
    });
  } catch (error) {
    console.error('Error solicitando plan:', error);
    res.status(500).json({ error: 'Error al solicitar el plan' });
  }
};