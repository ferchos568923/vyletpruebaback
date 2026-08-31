import { prisma } from '../services/prisma.js';
import { canGestionarSucursal } from '../middlewares/auth.js';
import { permiteReservas } from '../services/planes.service.js';
const estadosValidos = ['pendiente', 'confirmada', 'cancelada', 'completada'];
const estadosOcupan = ['pendiente', 'confirmada'];
const horaStr = (d) => {
    if (!d)
        return null;
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
};
const serializar = (r) => ({ ...r, hora_visita: horaStr(r.hora_visita) });
// GET /api/sucursales/:id/reservas-visita?fecha=YYYY-MM-DD  (público: disponibilidad por día)
export const disponibilidad = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, activo: true } });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        const aforo = sucursal.aforo_maximo ?? null;
        if (aforo == null) {
            return res.json({ aforo_maximo: null, usados: 0, cupos: null, libre: null });
        }
        const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : null;
        if (fecha && isNaN(fecha.getTime()))
            return res.status(400).json({ error: 'fecha inválida' });
        const where = { sucursal_id: sucursalId, estado: { in: estadosOcupan } };
        if (fecha)
            where.fecha_visita = fecha;
        const usados = await prisma.reservas_visita.aggregate({
            where,
            _sum: { cantidad_adultos: true, cantidad_ninos: true }
        });
        const totalUsados = Number(usados._sum.cantidad_adultos ?? 0) + Number(usados._sum.cantidad_ninos ?? 0);
        res.json({ aforo_maximo: aforo, usados: totalUsados, libre: Math.max(0, aforo - totalUsados) });
    }
    catch (error) {
        console.error('Error consultando disponibilidad de visita:', error);
        res.status(500).json({ error: 'Error al consultar disponibilidad' });
    }
};
// POST /api/sucursales/:id/reservas-visita  (cliente autenticado)
export const crearReservaVisita = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, activo: true } });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await permiteReservas(sucursal.empresa_id))) {
            return res.status(403).json({ error: 'Las reservas solo están disponibles en el plan Premium o superior. Actualiza tu plan.' });
        }
        const { fecha_visita, hora_visita, cantidad_adultos, cantidad_ninos, observaciones } = req.body;
        if (!fecha_visita) {
            return res.status(400).json({ error: 'fecha_visita es requerida' });
        }
        const fecha = new Date(fecha_visita);
        if (isNaN(fecha.getTime()))
            return res.status(400).json({ error: 'fecha_visita inválida' });
        const adultos = Math.max(0, Number(cantidad_adultos) || 0);
        const ninos = Math.max(0, Number(cantidad_ninos) || 0);
        if (adultos + ninos < 1) {
            return res.status(400).json({ error: 'Indica al menos un adulto o un niño' });
        }
        const aforo = sucursal.aforo_maximo;
        if (aforo != null) {
            const usados = await prisma.reservas_visita.aggregate({
                where: { sucursal_id: sucursalId, fecha_visita: fecha, estado: { in: estadosOcupan } },
                _sum: { cantidad_adultos: true, cantidad_ninos: true }
            });
            const totalUsados = Number(usados._sum.cantidad_adultos ?? 0) + Number(usados._sum.cantidad_ninos ?? 0);
            if (totalUsados + adultos + ninos > aforo) {
                return res.status(409).json({
                    error: `El lugar tiene aforo máximo de ${aforo} visitantes por día y ya hay ${totalUsados} reservados. Elige otra fecha.`
                });
            }
        }
        const reserva = await prisma.reservas_visita.create({
            data: {
                sucursal_id: sucursalId,
                usuario_id: req.user.id,
                fecha_visita: fecha,
                hora_visita: hora_visita ? new Date(`1970-01-01T${hora_visita.includes(':') ? hora_visita : `${hora_visita}:00`}`) : null,
                cantidad_adultos: adultos,
                cantidad_ninos: ninos,
                observaciones: observaciones || null,
                estado: 'pendiente',
                cliente_nombre: req.user ? `${req.user.nombres} ${req.user.apellidos ?? ''}`.trim() || null : null,
                cliente_telefono: req.user?.telefono || null
            },
            include: { sucursales: { include: { empresas: true } } }
        });
        res.status(201).json(serializar(reserva));
    }
    catch (error) {
        console.error('Error creando reserva de visita:', error);
        res.status(500).json({ error: 'Error al crear reserva de visita' });
    }
};
// GET /api/sucursales/:id/reservas-visita/listado  (dueño/staff de la sucursal)
export const listarReservasVisita = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId } });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await canGestionarSucursal(req, sucursal))) {
            return res.status(403).json({ error: 'No puedes ver reservas de visita de esta sucursal' });
        }
        const reservas = await prisma.reservas_visita.findMany({
            where: { sucursal_id: sucursalId },
            orderBy: { fecha_visita: 'desc' },
            include: {
                sucursales: { select: { id: true, nombre: true } },
                usuarios: {
                    select: { id: true, nombres: true, apellidos: true, correo: true, telefono: true, cedula: true }
                }
            }
        });
        res.json(reservas.map(serializar));
    }
    catch (error) {
        console.error('Error listando reservas de visita:', error);
        res.status(500).json({ error: 'Error al listar reservas de visita' });
    }
};
// PATCH /api/sucursales/:id/reservas-visita/:reservaId  { estado }  (dueño/staff)
export const actualizarEstadoVisita = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const reservaId = Number(req.params.reservaId);
        const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId } });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await canGestionarSucursal(req, sucursal))) {
            return res.status(403).json({ error: 'No puedes gestionar reservas de visita de esta sucursal' });
        }
        const { estado } = req.body;
        if (!estadosValidos.includes(estado)) {
            return res.status(400).json({ error: `estado inválido. Valores: ${estadosValidos.join(', ')}` });
        }
        const reserva = await prisma.reservas_visita.findFirst({ where: { id: reservaId, sucursal_id: sucursalId } });
        if (!reserva)
            return res.status(404).json({ error: 'Reserva no encontrada' });
        const actualizada = await prisma.reservas_visita.update({ where: { id: reservaId }, data: { estado } });
        res.json(serializar(actualizada));
    }
    catch (error) {
        console.error('Error actualizando reserva de visita:', error);
        res.status(500).json({ error: 'Error al actualizar reserva de visita' });
    }
};
// GET /api/usuarios/mis-reservas-visita  (cliente autenticado)
export const misReservasVisita = async (req, res) => {
    try {
        const reservas = await prisma.reservas_visita.findMany({
            where: { usuario_id: req.user.id },
            orderBy: { fecha_visita: 'desc' },
            include: {
                sucursales: {
                    include: {
                        ciudades: { select: { nombre: true } },
                        empresas: { select: { id: true, nombre: true } }
                    }
                }
            }
        });
        res.json(reservas.map(serializar));
    }
    catch (error) {
        console.error('Error listando mis reservas de visita:', error);
        res.status(500).json({ error: 'Error al listar mis reservas de visita' });
    }
};
// POST /api/visitas/sucursal/:id  — registrar una visita (puede ser anónima)
export const registrarVisita = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        if (!sucursalId)
            return res.status(400).json({ error: 'ID inválido' });
        const usuarioId = req.user?.id ?? null;
        await prisma.visitas_sucursal.create({
            data: {
                sucursal_id: sucursalId,
                usuario_id: usuarioId,
            },
        });
        res.json({ ok: true });
    }
    catch (error) {
        // No fallar la petición por esto — es tracking best-effort
        console.error('Error registrando visita:', error);
        res.json({ ok: true });
    }
};
