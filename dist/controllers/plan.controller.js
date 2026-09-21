import { prisma } from '../services/prisma.js';
import { canGestionarEmpresa } from '../middlewares/auth.js';
import { suscripcionActivaPorCedula, DIAS_DEFAULT_SUSCRIPCION, limiteSucursalesPorCedula, limiteProductosPorCedula, permiteCuponesPorCedula, permiteReservasPorCedula, permiteCartillasPorCedula } from '../services/planes.service.js';
export const obtenerPlan = async (req, res) => {
    try {
        const empresaId = Number(req.params.id);
        if (!(await canGestionarEmpresa(req, empresaId))) {
            return res.status(403).json({ error: 'No puedes gestionar esta empresa' });
        }
        const usuario = await prisma.usuarios.findUnique({
            where: { id: req.user.id },
            select: { cedula: true }
        });
        const cedula = usuario?.cedula ?? '';
        const [planes, suscripcion, pendiente, cantSucursales, limite, limiteProd, conCupones, conReservas, conCartillas] = await Promise.all([
            prisma.planes.findMany({ where: { activo: true }, orderBy: { precio: 'asc' } }),
            suscripcionActivaPorCedula(cedula),
            prisma.suscripciones.findFirst({
                where: { cedula, estado: 'pendiente' },
                orderBy: { fecha_fin: 'desc' },
                include: { planes: true }
            }),
            prisma.sucursales.count({ where: { empresa_id: empresaId, activo: true } }),
            limiteSucursalesPorCedula(cedula),
            limiteProductosPorCedula(cedula),
            permiteCuponesPorCedula(cedula),
            permiteReservasPorCedula(cedula),
            permiteCartillasPorCedula(cedula)
        ]);
        const usuarioEmpresas = await prisma.usuario_empresas.findMany({
            where: { usuario_id: req.user.id },
            select: { empresa_id: true }
        });
        const todasEmpresaIds = usuarioEmpresas.map((ue) => ue.empresa_id);
        const cantEmpresas = todasEmpresaIds.length;
        const limiteEmpresas = limite === null ? null : Math.max(1, Math.ceil(limite ?? 1));
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
            permite_reservas: conReservas,
            permite_cartillas: conCartillas
        });
    }
    catch (error) {
        console.error('Error obteniendo plan:', error);
        res.status(500).json({ error: 'Error al obtener el plan' });
    }
};
export const obtenerMiPlan = async (req, res) => {
    try {
        const usuario = await prisma.usuarios.findUnique({
            where: { id: req.user.id },
            select: { cedula: true }
        });
        const cedula = usuario?.cedula ?? '';
        const [planes, suscripcion, pendiente, limite, limiteProd, conCupones, conReservas, conCartillas] = await Promise.all([
            prisma.planes.findMany({ where: { activo: true }, orderBy: { precio: 'asc' } }),
            suscripcionActivaPorCedula(cedula),
            prisma.suscripciones.findFirst({
                where: { cedula, estado: 'pendiente' },
                orderBy: { fecha_fin: 'desc' },
                include: { planes: true }
            }),
            limiteSucursalesPorCedula(cedula),
            limiteProductosPorCedula(cedula),
            permiteCuponesPorCedula(cedula),
            permiteReservasPorCedula(cedula),
            permiteCartillasPorCedula(cedula)
        ]);
        const usuarioEmpresas = await prisma.usuario_empresas.findMany({
            where: { usuario_id: req.user.id },
            select: { empresa_id: true }
        });
        const todasEmpresaIds = usuarioEmpresas.map((ue) => ue.empresa_id);
        const cantSucursales = todasEmpresaIds.length > 0
            ? await prisma.sucursales.count({ where: { empresa_id: { in: todasEmpresaIds }, activo: true } })
            : 0;
        const cantProductos = todasEmpresaIds.length > 0
            ? await prisma.productos_servicios.count({ where: { activo: true, sucursales: { empresa_id: { in: todasEmpresaIds } } } })
            : 0;
        res.json({
            planes,
            suscripcion,
            plan_actual: suscripcion?.planes ?? null,
            solicitud_pendiente: pendiente?.planes ?? null,
            cant_sucursales: cantSucursales,
            limite_sucursales: limite,
            libre: limite === null ? Infinity : Math.max(0, limite - cantSucursales),
            cant_empresas: todasEmpresaIds.length,
            limite_empresas: limite === null ? null : Math.max(1, limite ?? 1),
            cant_productos: cantProductos,
            limite_productos: limiteProd,
            libre_productos: limiteProd === null ? Infinity : Math.max(0, limiteProd - cantProductos),
            permite_cupones: conCupones,
            permite_reservas: conReservas,
            permite_cartillas: conCartillas
        });
    }
    catch (error) {
        console.error('Error obteniendo mi plan:', error);
        res.status(500).json({ error: 'Error al obtener el plan' });
    }
};
export const activarPlan = async (req, res) => {
    try {
        const empresaId = Number(req.params.id);
        if (!(await canGestionarEmpresa(req, empresaId))) {
            return res.status(403).json({ error: 'No puedes gestionar esta empresa' });
        }
        const usuario = await prisma.usuarios.findUnique({
            where: { id: req.user.id },
            select: { cedula: true }
        });
        const cedula = usuario?.cedula ?? '';
        const planId = Number(req.body?.plan_id);
        const plan = await prisma.planes.findUnique({ where: { id: planId } });
        if (!plan)
            return res.status(404).json({ error: 'Plan no encontrado' });
        if (plan.activo === false)
            return res.status(400).json({ error: 'El plan no esta activo' });
        const ahora = new Date();
        const dias = plan.dias_duracion ?? DIAS_DEFAULT_SUSCRIPCION;
        const fechaFin = new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000);
        const suscripcion = await prisma.$transaction(async (tx) => {
            await tx.suscripciones.updateMany({
                where: { cedula, estado: 'pendiente' },
                data: { estado: 'inactiva' }
            });
            const creada = await tx.suscripciones.create({
                data: {
                    empresa_id: empresaId,
                    cedula,
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
            message: `Solicitud del plan ${plan.nombre} enviada. El administrador la revisara. Se aplicara a todas tus empresas.`,
            suscripcion
        });
    }
    catch (error) {
        console.error('Error solicitando plan:', error);
        res.status(500).json({ error: 'Error al solicitar el plan' });
    }
};
export const solicitarMiPlan = async (req, res) => {
    try {
        const usuario = await prisma.usuarios.findUnique({
            where: { id: req.user.id },
            select: { cedula: true }
        });
        const cedula = usuario?.cedula ?? '';
        if (!cedula)
            return res.status(400).json({ error: 'Tu usuario no tiene cedula registrada' });
        const planId = Number(req.body?.plan_id);
        const plan = await prisma.planes.findUnique({ where: { id: planId } });
        if (!plan)
            return res.status(404).json({ error: 'Plan no encontrado' });
        if (plan.activo === false)
            return res.status(400).json({ error: 'El plan no esta activo' });
        const ahora = new Date();
        const dias = plan.dias_duracion ?? DIAS_DEFAULT_SUSCRIPCION;
        const fechaFin = new Date(ahora.getTime() + dias * 24 * 60 * 60 * 1000);
        const suscripcion = await prisma.$transaction(async (tx) => {
            await tx.suscripciones.updateMany({
                where: { cedula, estado: 'pendiente' },
                data: { estado: 'inactiva' }
            });
            const primeraEmpresa = await tx.usuario_empresas.findFirst({
                where: { usuario_id: req.user.id },
                select: { empresa_id: true }
            });
            const empresaId = primeraEmpresa?.empresa_id ?? 0;
            const creada = await tx.suscripciones.create({
                data: {
                    empresa_id: empresaId || undefined,
                    cedula,
                    plan_id: plan.id,
                    fecha_inicio: ahora,
                    fecha_fin: fechaFin,
                    estado: 'pendiente'
                }
            });
            if (empresaId) {
                await tx.pagos.create({
                    data: {
                        empresa_id: empresaId,
                        suscripcion_id: creada.id,
                        monto: plan.precio,
                        metodo_pago: 'simulacion',
                        estado: 'pendiente'
                    }
                });
            }
            return creada;
        });
        res.status(201).json({
            message: `Solicitud del plan ${plan.nombre} enviada. Se aplicara a todas tus empresas.`,
            suscripcion
        });
    }
    catch (error) {
        console.error('Error solicitando mi plan:', error);
        res.status(500).json({ error: 'Error al solicitar el plan' });
    }
};
