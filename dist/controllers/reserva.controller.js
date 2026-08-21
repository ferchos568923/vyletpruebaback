import { prisma } from '../services/prisma.js';
import { canGestionarEmpresaConPermiso, canGestionarSucursal, sucursalesAsignadasEmpleado } from '../middlewares/auth.js';
import { permiteReservas } from '../services/planes.service.js';
const usuarioSelect = {
    id: true,
    nombres: true,
    apellidos: true,
    correo: true,
    telefono: true,
    cedula: true
};
const estadosValidos = ['pendiente', 'confirmada', 'cancelada', 'completada'];
const estadosOcupan = ['pendiente', 'confirmada'];
const timeToDate = (hora) => {
    if (!hora)
        return null;
    const limpia = hora.includes(':') ? hora : `${hora}:00`;
    return new Date(`1970-01-01T${limpia}`);
};
// Convierte la hora (columna @db.Time) a "HH:MM" en la zona horaria del servidor
const horaStr = (d) => {
    if (!d)
        return null;
    const s = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    return s;
};
const esRestaurante = async (sucursalId) => {
    const s = await prisma.sucursales.findUnique({
        where: { id: sucursalId },
        select: { empresas: { select: { categorias_negocio: { select: { permite_mesas: true } } } } }
    });
    return s?.empresas?.categorias_negocio?.permite_mesas === true;
};
const serializar = (r) => ({ ...r, hora_inicio: horaStr(r.hora_inicio), hora_fin: horaStr(r.hora_fin) });
// Valida las mesas seleccionadas y comprueba disponibilidad a esa fecha/hora
const validarMesas = async (sucursalId, fecha, hora, mesaIds = [], cantidades = []) => {
    if (!hora)
        return { error: 'hora_inicio es requerida (HH:MM)', status: 400 };
    if (!mesaIds.length)
        return { error: 'Selecciona una mesa para reservar', status: 400 };
    const mesas = await prisma.mesas.findMany({
        where: { id: { in: mesaIds }, sucursal_id: sucursalId, activa: true }
    });
    if (mesas.length !== new Set(mesaIds).size) {
        return { error: 'Una de las mesas no existe o está inactiva', status: 404 };
    }
    const ocupadas = [];
    for (const mesa of mesas) {
        const idx = mesaIds.indexOf(mesa.id);
        const cant = Number(cantidades[idx]) || 1;
        if (!Number.isInteger(cant) || cant < 1) {
            return { error: `La cantidad de mesas "${mesa.nombre}" debe ser un entero mayor o igual a 1`, status: 400 };
        }
        const reservadas = await prisma.reservas.count({
            where: {
                mesa_id: mesa.id,
                fecha_reserva: fecha,
                hora_inicio: timeToDate(hora) ?? undefined,
                estado: { in: estadosOcupan }
            }
        });
        if (reservadas + cant > mesa.cantidad)
            ocupadas.push(mesa.nombre);
    }
    if (ocupadas.length) {
        return {
            error: `Las mesas ${ocupadas.join(', ')} no tienen suficientes unidades disponibles a esa hora. Elige otra mesa u hora.`,
            status: 409
        };
    }
    return { mesas: mesas.map((m) => ({ id: m.id })) };
};
const crearReservas = async (data) => {
    const base = {
        sucursal_id: data.sucursalId,
        fecha_reserva: data.fecha,
        hora_inicio: data.hora ? timeToDate(data.hora) : null,
        cantidad_personas: data.cantidadPersonas ? Number(data.cantidadPersonas) : 1,
        observaciones: data.observaciones || null,
        estado: 'pendiente',
        usuario_id: data.usuarioId ?? null,
        cliente_nombre: data.cliente?.nombre || null,
        cliente_telefono: data.cliente?.telefono || null,
        cliente_correo: data.cliente?.correo || null
    };
    const expandidos = (data.mesaIds && data.mesaIds.length ? data.mesaIds : [null]).flatMap((mid, i) => Array.from({ length: (data.cantidades?.[i] ?? 1) || 1 }).map(() => mid));
    const rows = expandidos.map((mid) => prisma.reservas.create({
        data: { ...base, mesa_id: mid },
        include: { sucursales: { include: { empresas: true } }, mesas: true }
    }));
    return prisma.$transaction(rows);
};
// POST /api/sucursales/:id/reservas  (cliente autenticado; acepta mesa_id o mesa_ids[])
export const crearReserva = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, activo: true } });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await permiteReservas(sucursal.empresa_id))) {
            return res.status(403).json({ error: 'Esta empresa no ofrece reservas. Disponible solo en el plan Premium o superior.' });
        }
        const { fecha_reserva, hora_inicio, mesa_id, mesa_ids, cantidades, cantidad_personas, observaciones } = req.body;
        if (!fecha_reserva) {
            return res.status(400).json({ error: 'fecha_reserva es requerida' });
        }
        const fecha = new Date(fecha_reserva);
        if (isNaN(fecha.getTime()))
            return res.status(400).json({ error: 'fecha_reserva inválida' });
        const restaurante = await esRestaurante(sucursalId);
        let mesaIds;
        let cants = [];
        if (restaurante) {
            const ids = mesa_ids?.length ? mesa_ids.map(Number) : mesa_id ? [Number(mesa_id)] : [];
            cants = Array.isArray(cantidades) ? cantidades.map(Number) : ids.map(() => (cantidades != null ? Number(cantidades) : 1));
            const check = await validarMesas(sucursalId, fecha, hora_inicio, ids, cants);
            if (check.error)
                return res.status(check.status ?? 400).json({ error: check.error });
            mesaIds = ids;
        }
        const creadas = await crearReservas({
            sucursalId,
            fecha,
            hora: hora_inicio,
            mesaIds,
            cantidades: cants,
            cantidadPersonas: cantidad_personas,
            observaciones,
            usuarioId: req.user.id
        });
        res.status(201).json({ reservas: creadas.map(serializar) });
    }
    catch (error) {
        console.error('Error creando reserva:', error);
        res.status(500).json({ error: 'Error al crear reserva' });
    }
};
// POST /api/sucursales/:id/reservas/manual  (dueño/staff/empleado de la sucursal)
export const crearReservaManual = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const sucursal = await prisma.sucursales.findUnique({
            where: { id: sucursalId },
            select: { id: true, empresa_id: true, activo: true }
        });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await canGestionarSucursal(req, sucursal))) {
            return res.status(403).json({ error: 'No puedes registrar reservas en esta sucursal' });
        }
        if (!sucursal.activo)
            return res.status(400).json({ error: 'La sucursal está inactiva' });
        if (!(await permiteReservas(sucursal.empresa_id))) {
            return res.status(403).json({ error: 'Las reservas solo están disponibles en el plan Premium o superior. Actualiza tu plan.' });
        }
        const { fecha_reserva, hora_inicio, mesa_id, mesa_ids, cantidades, cantidad_personas, observaciones, cliente_nombre, cliente_telefono, cliente_correo } = req.body;
        if (!fecha_reserva) {
            return res.status(400).json({ error: 'fecha_reserva es requerida' });
        }
        const fecha = new Date(fecha_reserva);
        if (isNaN(fecha.getTime()))
            return res.status(400).json({ error: 'fecha_reserva inválida' });
        const restaurante = await esRestaurante(sucursalId);
        let mesaIds;
        let cants = [];
        if (restaurante) {
            const ids = mesa_ids?.length ? mesa_ids.map(Number) : mesa_id ? [Number(mesa_id)] : [];
            cants = Array.isArray(cantidades) ? cantidades.map(Number) : ids.map(() => (cantidades != null ? Number(cantidades) : 1));
            const check = await validarMesas(sucursalId, fecha, hora_inicio, ids, cants);
            if (check.error)
                return res.status(check.status ?? 400).json({ error: check.error });
            mesaIds = ids;
        }
        const creadas = await crearReservas({
            sucursalId,
            fecha,
            hora: hora_inicio,
            mesaIds,
            cantidades: cants,
            cantidadPersonas: cantidad_personas,
            observaciones,
            usuarioId: null,
            cliente: { nombre: cliente_nombre, telefono: cliente_telefono, correo: cliente_correo }
        });
        res.status(201).json({ reservas: creadas.map(serializar) });
    }
    catch (error) {
        console.error('Error registrando reserva manual:', error);
        res.status(500).json({ error: 'Error al registrar reserva' });
    }
};
// GET /api/mis-reservas  (cliente autenticado)
export const misReservas = async (req, res) => {
    try {
        const reservas = await prisma.reservas.findMany({
            where: { usuario_id: req.user.id },
            orderBy: { fecha_reserva: 'desc' },
            include: {
                sucursales: {
                    include: { ciudades: { select: { nombre: true } }, empresas: { select: { id: true, nombre: true } } }
                },
                mesas: true
            }
        });
        res.json(reservas.map((r) => ({ ...r, hora_inicio: horaStr(r.hora_inicio), hora_fin: horaStr(r.hora_fin) })));
    }
    catch (error) {
        console.error('Error listando mis reservas:', error);
        res.status(500).json({ error: 'Error al listar mis reservas' });
    }
};
// GET /api/empresas/:id/reservas  (dueño/staff o empleado con permiso gestionar_reservas)
export const listarReservasEmpresa = async (req, res) => {
    try {
        const empresaId = Number(req.params.id);
        if (!(await canGestionarEmpresaConPermiso(req, empresaId, 'gestionar_reservas'))) {
            return res.status(403).json({ error: 'No puedes ver reservas de esta empresa' });
        }
        // Si es empleado, solo ve las reservas de sus sucursales asignadas
        const asignadas = await sucursalesAsignadasEmpleado(req.user.id, empresaId);
        const where = { sucursales: { empresa_id: empresaId } };
        if (asignadas !== null)
            where.sucursales.id = { in: asignadas };
        const reservas = await prisma.reservas.findMany({
            where,
            orderBy: { fecha_reserva: 'desc' },
            include: {
                sucursales: { select: { id: true, nombre: true } },
                usuarios: { select: usuarioSelect },
                mesas: true
            }
        });
        res.json(reservas.map((r) => ({ ...r, hora_inicio: horaStr(r.hora_inicio), hora_fin: horaStr(r.hora_fin) })));
    }
    catch (error) {
        console.error('Error listando reservas de la empresa:', error);
        res.status(500).json({ error: 'Error al listar reservas' });
    }
};
// PATCH /api/empresas/:id/reservas/:reservaId  { estado }
export const actualizarEstadoReserva = async (req, res) => {
    try {
        const empresaId = Number(req.params.id);
        const reservaId = Number(req.params.reservaId);
        if (!(await canGestionarEmpresaConPermiso(req, empresaId, 'gestionar_reservas'))) {
            return res.status(403).json({ error: 'No puedes gestionar reservas de esta empresa' });
        }
        const { estado } = req.body;
        if (!estadosValidos.includes(estado)) {
            return res.status(400).json({ error: `estado inválido. Valores: ${estadosValidos.join(', ')}` });
        }
        const reserva = await prisma.reservas.findFirst({
            where: { id: reservaId, sucursales: { empresa_id: empresaId } }
        });
        if (!reserva)
            return res.status(404).json({ error: 'Reserva no encontrada' });
        // Si es empleado, solo puede gestionar reservas de sus sucursales asignadas
        const asignadas = await sucursalesAsignadasEmpleado(req.user.id, empresaId);
        if (asignadas !== null && !asignadas.includes(reserva.sucursal_id)) {
            return res.status(403).json({ error: 'No puedes gestionar reservas de otras sucursales' });
        }
        const actualizada = await prisma.reservas.update({ where: { id: reservaId }, data: { estado } });
        res.json(actualizada);
    }
    catch (error) {
        console.error('Error actualizando reserva:', error);
        res.status(500).json({ error: 'Error al actualizar reserva' });
    }
};
// GET /api/sucursales/:id/reservas  (dueño/staff/empleado de la sucursal)
export const listarReservasSucursal = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const sucursal = await prisma.sucursales.findUnique({
            where: { id: sucursalId },
            select: { id: true, empresa_id: true }
        });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await canGestionarSucursal(req, sucursal))) {
            return res.status(403).json({ error: 'No puedes ver reservas de esta sucursal' });
        }
        const reservas = await prisma.reservas.findMany({
            where: { sucursal_id: sucursalId },
            orderBy: { fecha_reserva: 'desc' },
            include: {
                sucursales: { select: { id: true, nombre: true } },
                usuarios: { select: usuarioSelect },
                mesas: true
            }
        });
        res.json(reservas.map((r) => ({ ...r, hora_inicio: horaStr(r.hora_inicio), hora_fin: horaStr(r.hora_fin) })));
    }
    catch (error) {
        console.error('Error listando reservas de la sucursal:', error);
        res.status(500).json({ error: 'Error al listar reservas' });
    }
};
// PATCH /api/sucursales/:id/reservas/:reservaId  { estado }
export const actualizarEstadoReservaSucursal = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const reservaId = Number(req.params.reservaId);
        const sucursal = await prisma.sucursales.findUnique({
            where: { id: sucursalId },
            select: { id: true, empresa_id: true }
        });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await canGestionarSucursal(req, sucursal))) {
            return res.status(403).json({ error: 'No puedes gestionar reservas de esta sucursal' });
        }
        const { estado } = req.body;
        if (!estadosValidos.includes(estado)) {
            return res.status(400).json({ error: `estado inválido. Valores: ${estadosValidos.join(', ')}` });
        }
        const reserva = await prisma.reservas.findFirst({ where: { id: reservaId, sucursal_id: sucursalId } });
        if (!reserva)
            return res.status(404).json({ error: 'Reserva no encontrada' });
        const actualizada = await prisma.reservas.update({ where: { id: reservaId }, data: { estado } });
        res.json(actualizada);
    }
    catch (error) {
        console.error('Error actualizando reserva:', error);
        res.status(500).json({ error: 'Error al actualizar reserva' });
    }
};
