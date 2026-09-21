import { prisma } from '../services/prisma.js';
// GET /api/estadisticas/mias?meses=12&inicio=2025-01-01&fin=2025-12-31&empresa_id=5&sucursal_id=7
export const misEstadisticas = async (req, res) => {
    try {
        const userId = req.user.id;
        // Filtros
        const meses = Number(req.query.meses) || 12;
        const inicioQuery = req.query.inicio;
        const finQuery = req.query.fin;
        const empresaIdFilter = req.query.empresa_id ? Number(req.query.empresa_id) : null;
        const sucursalIdFilter = req.query.sucursal_id ? Number(req.query.sucursal_id) : null;
        const hoy = new Date();
        const fechaInicio = inicioQuery
            ? new Date(inicioQuery)
            : new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1);
        const fechaFin = finQuery ? new Date(finQuery + 'T23:59:59') : hoy;
        // Obtener empresas del usuario
        const empresas = await prisma.empresas.findMany({
            where: {
                activo: true,
                OR: [
                    { usuario_empresas: { some: { usuario_id: userId } } },
                    { propietario: req.user.correo }
                ]
            },
            select: { id: true, nombre: true }
        });
        if (empresas.length === 0) {
            return res.json({ premium: false, empresas: [] });
        }
        const empresaIds = empresaIdFilter
            ? empresas.filter((e) => e.id === empresaIdFilter).map((e) => e.id)
            : empresas.map((e) => e.id);
        if (empresaIds.length === 0) {
            return res.json({ premium: true, empresas: [], resumen: null, mensual: [], sucursales: [], negocios: [] });
        }
        // Verificar plan activo
        const subs = await prisma.suscripciones.findMany({
            where: {
                empresa_id: { in: empresaIds },
                estado: 'activa',
                fecha_fin: { gte: new Date() }
            },
            include: { planes: true }
        });
        if (subs.length === 0) {
            return res.json({ premium: false, empresas: [] });
        }
        // Sucursales (filtradas por empresa si se especifica)
        const sucursales = await prisma.sucursales.findMany({
            where: { empresa_id: { in: empresaIds }, activo: true },
            select: { id: true, nombre: true, empresa_id: true }
        });
        // Filtro por sucursal individual (validar pertenencia)
        if (sucursalIdFilter) {
            const una = sucursales.find((s) => s.id === sucursalIdFilter);
            if (!una) {
                return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
            }
            return misEstadisticasSucursal(req, res, una, fechaInicio, fechaFin);
        }
        const sucIds = sucursales.map((s) => s.id);
        if (sucIds.length === 0) {
            return res.json({ premium: true, empresas, resumen: null, mensual: [], sucursales: [], negocios: [] });
        }
        // Resumen global en el rango seleccionado
        const whereVis = { sucursal_id: { in: sucIds }, fecha_visita: { gte: fechaInicio, lte: fechaFin } };
        const whereFav = { sucursal_id: { in: sucIds }, fecha_creacion: { gte: fechaInicio, lte: fechaFin } };
        const [totalVisitas, totalFavoritos, totalResenas, promedioCalificacion, reservasPorEstado, reservasVisitaPorEstado, habitacionesReservadas, cuponesCanjeados,] = await Promise.all([
            prisma.visitas_sucursal.count({ where: whereVis }),
            prisma.favoritos.count({ where: whereFav }),
            prisma.resenas.count({ where: whereFav }),
            prisma.resenas.aggregate({ where: { sucursal_id: { in: sucIds } }, _avg: { calificacion: true } }),
            prisma.reservas.groupBy({ by: ['estado'], where: { sucursal_id: { in: sucIds }, fecha_creacion: { gte: fechaInicio, lte: fechaFin } }, _count: { id: true } }),
            prisma.reservas_visita.groupBy({ by: ['estado'], where: { sucursal_id: { in: sucIds }, fecha_creacion: { gte: fechaInicio, lte: fechaFin } }, _count: { id: true } }),
            prisma.reservas_habitacion.count({ where: { habitaciones: { sucursal_id: { in: sucIds } }, fecha_entrada: { gte: fechaInicio, lte: fechaFin } } }),
            prisma.cupones_usuario.count({ where: { cupones: { sucursal_id: { in: sucIds } }, fecha_uso: { gte: fechaInicio, lte: fechaFin } } }),
        ]);
        const reservasConfirmadas = reservasPorEstado.find((r) => r.estado === 'confirmada')?._count.id ?? 0;
        const reservasPendientes = reservasPorEstado.find((r) => r.estado === 'pendiente')?._count.id ?? 0;
        const reservasCanceladas = reservasPorEstado.find((r) => r.estado === 'cancelada')?._count.id ?? 0;
        const reservasCompletadas = reservasPorEstado.find((r) => r.estado === 'completada')?._count.id ?? 0;
        const totalReservas = reservasConfirmadas + reservasPendientes + reservasCanceladas + reservasCompletadas;
        // Desglose mensual
        const mensual = [];
        for (let i = meses - 1; i >= 0; i--) {
            const mi = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
            const mf = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0, 23, 59, 59);
            const label = mi.toLocaleDateString('es-EC', { year: 'numeric', month: 'short' });
            const [vis, fav, res, hab, cup, resRes] = await Promise.all([
                prisma.visitas_sucursal.count({ where: { sucursal_id: { in: sucIds }, fecha_visita: { gte: mi, lte: mf } } }),
                prisma.favoritos.count({ where: { sucursal_id: { in: sucIds }, fecha_creacion: { gte: mi, lte: mf } } }),
                prisma.resenas.count({ where: { sucursal_id: { in: sucIds }, fecha_creacion: { gte: mi, lte: mf } } }),
                prisma.reservas_habitacion.count({ where: { habitaciones: { sucursal_id: { in: sucIds } }, fecha_entrada: { gte: mi, lte: mf } } }),
                prisma.cupones_usuario.count({ where: { cupones: { sucursal_id: { in: sucIds } }, fecha_uso: { gte: mi, lte: mf } } }),
                prisma.reservas.count({ where: { sucursal_id: { in: sucIds }, fecha_creacion: { gte: mi, lte: mf } } }),
            ]);
            mensual.push({ mes: label, visitas: vis, favoritos: fav, resenas: res, reservas: resRes, habitaciones: hab, cupones: cup });
        }
        // Stats por sucursal
        const statsPorSucursal = await Promise.all(sucursales.map(async (suc) => {
            const [visitas, favoritos, resenas, calProm, resReservas, resVisita, habRes, cupCanj] = await Promise.all([
                prisma.visitas_sucursal.count({ where: { sucursal_id: suc.id, fecha_visita: { gte: fechaInicio, lte: fechaFin } } }),
                prisma.favoritos.count({ where: { sucursal_id: suc.id, fecha_creacion: { gte: fechaInicio, lte: fechaFin } } }),
                prisma.resenas.count({ where: { sucursal_id: suc.id, fecha_creacion: { gte: fechaInicio, lte: fechaFin } } }),
                prisma.resenas.aggregate({ where: { sucursal_id: suc.id }, _avg: { calificacion: true } }),
                prisma.reservas.groupBy({ by: ['estado'], where: { sucursal_id: suc.id, fecha_creacion: { gte: fechaInicio, lte: fechaFin } }, _count: { id: true } }),
                prisma.reservas_visita.groupBy({ by: ['estado'], where: { sucursal_id: suc.id, fecha_creacion: { gte: fechaInicio, lte: fechaFin } }, _count: { id: true } }),
                prisma.reservas_habitacion.count({ where: { habitaciones: { sucursal_id: suc.id }, fecha_entrada: { gte: fechaInicio, lte: fechaFin } } }),
                prisma.cupones_usuario.count({ where: { cupones: { sucursal_id: suc.id }, fecha_uso: { gte: fechaInicio, lte: fechaFin } } }),
            ]);
            return {
                id: suc.id, nombre: suc.nombre, empresa_id: suc.empresa_id,
                visitas, favoritos, resenas,
                calificacion: calProm._avg.calificacion ?? 0,
                reservas: {
                    total: resReservas.reduce((a, r) => a + r._count.id, 0),
                    pendientes: resReservas.find((r) => r.estado === 'pendiente')?._count.id ?? 0,
                    confirmadas: resReservas.find((r) => r.estado === 'confirmada')?._count.id ?? 0,
                    completadas: resReservas.find((r) => r.estado === 'completada')?._count.id ?? 0,
                    canceladas: resReservas.find((r) => r.estado === 'cancelada')?._count.id ?? 0,
                },
                reservasVisita: {
                    total: resVisita.reduce((a, r) => a + r._count.id, 0),
                    pendientes: resVisita.find((r) => r.estado === 'pendiente')?._count.id ?? 0,
                    confirmadas: resVisita.find((r) => r.estado === 'confirmada')?._count.id ?? 0,
                    canceladas: resVisita.find((r) => r.estado === 'cancelada')?._count.id ?? 0,
                },
                habitacionesReservadas: habRes, cuponesCanjeados: cupCanj,
            };
        }));
        // Stats por negocio (empresa)
        const negocios = await Promise.all(empresas.filter((e) => empresaIds.includes(e.id)).map(async (emp) => {
            const sucEmp = sucursales.filter((s) => s.empresa_id === emp.id);
            const sucEmpIds = sucEmp.map((s) => s.id);
            if (sucEmpIds.length === 0) {
                return {
                    id: emp.id, nombre: emp.nombre,
                    visitas: 0, favoritos: 0, resenas: 0, calificacion: 0,
                    reservas: { total: 0, confirmadas: 0, pendientes: 0, completadas: 0, canceladas: 0 },
                    habitacionesReservadas: 0, cuponesCanjeados: 0, sucursales: 0,
                };
            }
            const [vis, fav, res, cal, resRes, hab, cup] = await Promise.all([
                prisma.visitas_sucursal.count({ where: { sucursal_id: { in: sucEmpIds }, fecha_visita: { gte: fechaInicio, lte: fechaFin } } }),
                prisma.favoritos.count({ where: { sucursal_id: { in: sucEmpIds }, fecha_creacion: { gte: fechaInicio, lte: fechaFin } } }),
                prisma.resenas.count({ where: { sucursal_id: { in: sucEmpIds }, fecha_creacion: { gte: fechaInicio, lte: fechaFin } } }),
                prisma.resenas.aggregate({ where: { sucursal_id: { in: sucEmpIds } }, _avg: { calificacion: true } }),
                prisma.reservas.groupBy({ by: ['estado'], where: { sucursal_id: { in: sucEmpIds }, fecha_creacion: { gte: fechaInicio, lte: fechaFin } }, _count: { id: true } }),
                prisma.reservas_habitacion.count({ where: { habitaciones: { sucursal_id: { in: sucEmpIds } }, fecha_entrada: { gte: fechaInicio, lte: fechaFin } } }),
                prisma.cupones_usuario.count({ where: { cupones: { sucursal_id: { in: sucEmpIds } }, fecha_uso: { gte: fechaInicio, lte: fechaFin } } }),
            ]);
            return {
                id: emp.id, nombre: emp.nombre,
                visitas: vis, favoritos: fav, resenas: res,
                calificacion: cal._avg.calificacion ?? 0,
                reservas: {
                    total: resRes.reduce((a, r) => a + r._count.id, 0),
                    confirmadas: resRes.find((r) => r.estado === 'confirmada')?._count.id ?? 0,
                    pendientes: resRes.find((r) => r.estado === 'pendiente')?._count.id ?? 0,
                    completadas: resRes.find((r) => r.estado === 'completada')?._count.id ?? 0,
                    canceladas: resRes.find((r) => r.estado === 'cancelada')?._count.id ?? 0,
                },
                habitacionesReservadas: hab, cuponesCanjeados: cup,
                sucursales: sucEmp.length,
            };
        }));
        res.json({
            premium: true,
            empresas,
            rango: { inicio: fechaInicio.toISOString(), fin: fechaFin.toISOString() },
            resumen: {
                totalVisitas, totalFavoritos, totalResenas,
                calificacionPromedio: promedioCalificacion._avg.calificacion ?? 0,
                totalReservas, reservasConfirmadas, reservasPendientes, reservasCompletadas, reservasCanceladas,
                visitasReserva: reservasVisitaPorEstado.reduce((a, r) => a + r._count.id, 0),
                habitacionesReservadas, cuponesCanjeados,
            },
            mensual, sucursales: statsPorSucursal, negocios
        });
    }
    catch (error) {
        console.error('Error obteniendo estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
};
// Estadísticas de una sola sucursal (llamado desde misEstadisticas con ?sucursal_id=)
const misEstadisticasSucursal = async (_req, res, suc, fechaInicio, fechaFin) => {
    try {
        const id = suc.id;
        const [totalVisitas, totalFavoritos, totalResenas, promedioCalificacion, reservasPorEstado, reservasVisitaPorEstado, habitacionesReservadas, cuponesCanjeados,] = await Promise.all([
            prisma.visitas_sucursal.count({ where: { sucursal_id: id, fecha_visita: { gte: fechaInicio, lte: fechaFin } } }),
            prisma.favoritos.count({ where: { sucursal_id: id, fecha_creacion: { gte: fechaInicio, lte: fechaFin } } }),
            prisma.resenas.count({ where: { sucursal_id: id, fecha_creacion: { gte: fechaInicio, lte: fechaFin } } }),
            prisma.resenas.aggregate({ where: { sucursal_id: id }, _avg: { calificacion: true } }),
            prisma.reservas.groupBy({ by: ['estado'], where: { sucursal_id: id, fecha_creacion: { gte: fechaInicio, lte: fechaFin } }, _count: { id: true } }),
            prisma.reservas_visita.groupBy({ by: ['estado'], where: { sucursal_id: id, fecha_creacion: { gte: fechaInicio, lte: fechaFin } }, _count: { id: true } }),
            prisma.reservas_habitacion.count({ where: { habitaciones: { sucursal_id: id }, fecha_entrada: { gte: fechaInicio, lte: fechaFin } } }),
            prisma.cupones_usuario.count({ where: { cupones: { sucursal_id: id }, fecha_uso: { gte: fechaInicio, lte: fechaFin } } }),
        ]);
        const reservasConfirmadas = reservasPorEstado.find((r) => r.estado === 'confirmada')?._count.id ?? 0;
        const reservasPendientes = reservasPorEstado.find((r) => r.estado === 'pendiente')?._count.id ?? 0;
        const reservasCanceladas = reservasPorEstado.find((r) => r.estado === 'cancelada')?._count.id ?? 0;
        const reservasCompletadas = reservasPorEstado.find((r) => r.estado === 'completada')?._count.id ?? 0;
        const totalReservas = reservasConfirmadas + reservasPendientes + reservasCanceladas + reservasCompletadas;
        const mensual = [];
        const cursor = new Date(fechaInicio.getFullYear(), fechaInicio.getMonth(), 1);
        const fin = new Date(fechaFin.getFullYear(), fechaFin.getMonth(), 1);
        while (cursor <= fin) {
            const mi = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
            const mf = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59);
            const label = mi.toLocaleDateString('es-EC', { year: 'numeric', month: 'short' });
            const [vis, fav, res, hab, cup, resRes] = await Promise.all([
                prisma.visitas_sucursal.count({ where: { sucursal_id: id, fecha_visita: { gte: mi, lte: mf } } }),
                prisma.favoritos.count({ where: { sucursal_id: id, fecha_creacion: { gte: mi, lte: mf } } }),
                prisma.resenas.count({ where: { sucursal_id: id, fecha_creacion: { gte: mi, lte: mf } } }),
                prisma.reservas_habitacion.count({ where: { habitaciones: { sucursal_id: id }, fecha_entrada: { gte: mi, lte: mf } } }),
                prisma.cupones_usuario.count({ where: { cupones: { sucursal_id: id }, fecha_uso: { gte: mi, lte: mf } } }),
                prisma.reservas.count({ where: { sucursal_id: id, fecha_creacion: { gte: mi, lte: mf } } }),
            ]);
            mensual.push({ mes: label, visitas: vis, favoritos: fav, resenas: res, reservas: resRes, habitaciones: hab, cupones: cup });
            cursor.setMonth(cursor.getMonth() + 1);
        }
        res.json({
            premium: true,
            sucursal: { id: suc.id, nombre: suc.nombre },
            rango: { inicio: fechaInicio.toISOString(), fin: fechaFin.toISOString() },
            resumen: {
                totalVisitas, totalFavoritos, totalResenas,
                calificacionPromedio: promedioCalificacion._avg.calificacion ?? 0,
                totalReservas, reservasConfirmadas, reservasPendientes, reservasCompletadas, reservasCanceladas,
                visitasReserva: reservasVisitaPorEstado.reduce((a, r) => a + r._count.id, 0),
                habitacionesReservadas, cuponesCanjeados,
            },
            mensual,
        });
    }
    catch (error) {
        console.error('Error obteniendo estadísticas de sucursal:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
};
