import { prisma } from '../services/prisma.js';
import { isStaff } from '../middlewares/auth.js';
const parseDecimal = (v) => v === undefined || v === null || v === '' ? undefined : Number(v);
const includeSolicitud = {
    usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true, telefono: true } },
    solicitud_intereses: { include: { tipos_interes: { select: { id: true, nombre: true } } } },
    recomendaciones: {
        include: {
            sucursales: {
                include: {
                    ciudades: { select: { id: true, nombre: true } },
                    empresas: { select: { id: true, nombre: true, logo: true } }
                }
            }
        },
        orderBy: { puntaje: 'desc' }
    }
};
const MAX_RECOMENDADOS = 5;
// Genera automáticamente las mejores sucursales para una solicitud.
// Puntúa cada sucursal activa según: intereses coincidentes, categoría turística,
// calificación, cantidad de reseñas, que el presupuesto alcance y que el aforo
// sea suficiente. Devuelve [{ sucursal_id, puntaje }] ordenados desc.
async function generarRecomendacionesAuto(opts) {
    const { tipo_interes_ids, presupuesto, cantidad_personas } = opts;
    const personas = cantidad_personas && cantidad_personas > 0 ? cantidad_personas : 1;
    const sucursales = await prisma.sucursales.findMany({
        where: { activo: true, empresas: { activo: true } },
        select: {
            id: true,
            gratuito: true,
            precio_adultos: true,
            precio_ninos: true,
            aforo_maximo: true,
            calificacion: true,
            total_resenas: true,
            sucursal_tipos_interes: { where: { tipo_interes_id: { in: tipo_interes_ids } }, select: { tipo_interes_id: true } },
            empresas: {
                select: {
                    verificado: true,
                    destacado: true,
                    categorias_negocio: { select: { nombre: true, permite_reservas: true } }
                }
            }
        }
    });
    const esTuristico = (categoria) => categoria !== null && (categoria.permite_reservas === true || /turistico|tour/i.test(categoria.nombre));
    const conPuntaje = sucursales.map((s) => {
        let score = 0;
        // Intereses coincidentes (peso principal, máx 90)
        const coincidencias = s.sucursal_tipos_interes.length;
        score += Math.min(coincidencias, 3) * 30;
        // Categoría turística
        if (esTuristico(s.empresas?.categorias_negocio ?? null))
            score += 10;
        // Calificación (0-5) * 8 => 0-40
        score += (s.calificacion !== null ? Number(s.calificacion) : 0) * 8;
        // Confianza por reseñas: hasta 100 reseñas => 0-20
        score += Math.min(s.total_resenas ?? 0, 100) * 0.2;
        // Presupuesto: costo de entrada estimado (adultos) * personas
        const costeEntrada = s.gratuito === true ? 0 : (s.precio_adultos !== null && s.precio_adultos !== undefined ? Number(s.precio_adultos) : 0);
        if (presupuesto !== undefined && costeEntrada > 0) {
            if (costeEntrada * personas <= presupuesto)
                score += 12;
            else
                score -= 8;
        }
        else if (s.gratuito === true) {
            score += 4;
        }
        // Aforo suficiente para el grupo
        if (s.aforo_maximo !== null && s.aforo_maximo !== undefined && personas <= s.aforo_maximo) {
            score += 5;
        }
        // Empresas verificadas/destacadas
        if (s.empresas?.verificado === true)
            score += 4;
        if (s.empresas?.destacado === true)
            score += 2;
        return { sucursal_id: s.id, puntaje: Math.round(score * 10) / 10 };
    });
    return conPuntaje
        .filter((r) => r.puntaje > 0)
        .sort((a, b) => b.puntaje - a.puntaje)
        .slice(0, MAX_RECOMENDADOS);
}
// POST /api/recomendaciones/solicitudes  (autenticado)
// El sistema calcula automáticamente las mejores recomendaciones en la base de datos.
export const crearSolicitud = async (req, res) => {
    try {
        const { presupuesto, cantidad_personas, cantidad_dias, observaciones, tipo_interes_ids } = req.body;
        if (cantidad_personas !== undefined && Number(cantidad_personas) < 1) {
            return res.status(400).json({ error: 'cantidad_personas debe ser mayor a 0' });
        }
        if (cantidad_dias !== undefined && Number(cantidad_dias) < 1) {
            return res.status(400).json({ error: 'cantidad_dias debe ser mayor a 0' });
        }
        const ids = Array.isArray(tipo_interes_ids)
            ? [...new Set(tipo_interes_ids.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))]
            : [];
        if (ids.length > 0) {
            const validos = await prisma.tipos_interes.count({ where: { id: { in: ids }, activo: true } });
            if (validos !== ids.length) {
                return res.status(400).json({ error: 'Algunos tipos de interés no existen o están inactivos' });
            }
        }
        const presup = parseDecimal(presupuesto);
        const personas = cantidad_personas !== undefined && cantidad_personas !== '' ? Number(cantidad_personas) : undefined;
        const recomendadas = await generarRecomendacionesAuto({
            tipo_interes_ids: ids,
            presupuesto: presup,
            cantidad_personas: personas
        });
        const solicitud = await prisma.$transaction(async (tx) => {
            const creada = await tx.solicitudes_recomendacion.create({
                data: {
                    usuario_id: req.user.id,
                    presupuesto: presup,
                    cantidad_personas: personas,
                    cantidad_dias: cantidad_dias !== undefined && cantidad_dias !== '' ? Number(cantidad_dias) : undefined,
                    observaciones: observaciones || null,
                    estado: recomendadas.length > 0 ? 'respondida' : 'pendiente',
                    solicitud_intereses: ids.length
                        ? { create: ids.map((tipo_interes_id) => ({ tipo_interes_id })) }
                        : undefined
                }
            });
            if (recomendadas.length > 0) {
                await tx.recomendaciones.createMany({
                    data: recomendadas.map((r) => ({
                        solicitud_id: creada.id,
                        sucursal_id: r.sucursal_id,
                        puntaje: r.puntaje
                    }))
                });
            }
            return tx.solicitudes_recomendacion.findUniqueOrThrow({
                where: { id: creada.id },
                include: includeSolicitud
            });
        });
        res.status(201).json(solicitud);
    }
    catch (error) {
        console.error('Error creando solicitud de recomendación:', error);
        res.status(500).json({ error: 'Error al crear solicitud de recomendación' });
    }
};
// GET /api/recomendaciones/mis-solicitudes  (autenticado)
export const misSolicitudes = async (req, res) => {
    try {
        const solicitudes = await prisma.solicitudes_recomendacion.findMany({
            where: { usuario_id: req.user.id },
            orderBy: { fecha_creacion: 'desc' },
            include: includeSolicitud
        });
        res.json(solicitudes);
    }
    catch (error) {
        console.error('Error listando mis solicitudes:', error);
        res.status(500).json({ error: 'Error al listar mis solicitudes' });
    }
};
// GET /api/admin/recomendaciones  (staff)
export const listarAdmin = async (req, res) => {
    try {
        const { estado } = req.query;
        const where = {};
        if (estado)
            where.estado = String(estado);
        const solicitudes = await prisma.solicitudes_recomendacion.findMany({
            where,
            orderBy: { fecha_creacion: 'desc' },
            include: includeSolicitud
        });
        res.json(solicitudes);
    }
    catch (error) {
        console.error('Error listando solicitudes (admin):', error);
        res.status(500).json({ error: 'Error al listar solicitudes' });
    }
};
// POST /api/admin/recomendaciones/:id/recomendar  (staff: recalcula automáticamente)
// Permite regenerar las recomendaciones de una solicitud sin intervención manual.
export const recomendar = async (req, res) => {
    try {
        const solicitudId = Number(req.params.id);
        const solicitud = await prisma.solicitudes_recomendacion.findUnique({
            where: { id: solicitudId },
            include: { solicitud_intereses: { select: { tipo_interes_id: true } } }
        });
        if (!solicitud)
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        const recomendadas = await generarRecomendacionesAuto({
            tipo_interes_ids: solicitud.solicitud_intereses.map((i) => i.tipo_interes_id),
            presupuesto: solicitud.presupuesto !== null && solicitud.presupuesto !== undefined ? Number(solicitud.presupuesto) : undefined,
            cantidad_personas: solicitud.cantidad_personas ?? undefined
        });
        await prisma.$transaction([
            prisma.recomendaciones.deleteMany({ where: { solicitud_id: solicitudId } }),
            prisma.recomendaciones.createMany({
                data: recomendadas.map((r) => ({
                    solicitud_id: solicitudId,
                    sucursal_id: r.sucursal_id,
                    puntaje: r.puntaje
                }))
            }),
            prisma.solicitudes_recomendacion.update({
                where: { id: solicitudId },
                data: { estado: recomendadas.length > 0 ? 'respondida' : 'pendiente' }
            })
        ]);
        const actualizada = await prisma.solicitudes_recomendacion.findUnique({
            where: { id: solicitudId },
            include: includeSolicitud
        });
        res.json(actualizada);
    }
    catch (error) {
        console.error('Error regenerando recomendaciones:', error);
        res.status(500).json({ error: 'Error al regenerar recomendaciones' });
    }
};
export { isStaff };
