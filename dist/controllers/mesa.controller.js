import { prisma } from '../services/prisma.js';
const estadosOcupan = ['pendiente', 'confirmada'];
const timeToDate = (hora) => {
    if (!hora)
        return null;
    const limpia = hora.includes(':') ? hora : `${hora}:00`;
    return new Date(`1970-01-01T${limpia}`);
};
// ¿El negocio de esta sucursal permite mesas (restaurantes)?
const esRestaurante = async (sucursalId) => {
    const s = await prisma.sucursales.findUnique({
        where: { id: sucursalId },
        select: { empresas: { select: { categorias_negocio: { select: { permite_mesas: true } } } } }
    });
    return s?.empresas?.categorias_negocio?.permite_mesas === true;
};
// GET /api/sucursales/:id/mesas  (público; solo restaurantes) - mesas activas
export const listarMesas = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        if (!(await esRestaurante(sucursalId)))
            return res.json([]);
        const mesas = await prisma.mesas.findMany({
            where: { sucursal_id: sucursalId, activa: true },
            orderBy: { id: 'asc' }
        });
        res.json(mesas);
    }
    catch (error) {
        console.error('Error listando mesas:', error);
        res.status(500).json({ error: 'Error al listar mesas' });
    }
};
// GET /api/sucursales/:id/mesas/disponibilidad?fecha=YYYY-MM-DD&hora=HH:MM  (público)
export const disponibilidadMesas = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        if (!(await esRestaurante(sucursalId)))
            return res.json([]);
        const { fecha, hora } = req.query;
        const fechaReserva = fecha ? new Date(String(fecha)) : null;
        const horaReserva = hora ? timeToDate(String(hora)) : null;
        if (!fechaReserva || !horaReserva) {
            return res.status(400).json({ error: 'fecha (YYYY-MM-DD) y hora (HH:MM) son requeridas' });
        }
        const mesas = await prisma.mesas.findMany({
            where: { sucursal_id: sucursalId, activa: true },
            orderBy: { id: 'asc' }
        });
        const reservadas = await prisma.reservas.groupBy({
            by: ['mesa_id'],
            where: {
                mesa_id: { in: mesas.map((m) => m.id) },
                fecha_reserva: fechaReserva,
                hora_inicio: horaReserva,
                estado: { in: estadosOcupan }
            },
            _count: { _all: true }
        });
        const ocupadasPorMesa = new Map(reservadas.map((r) => [r.mesa_id, r._count._all]));
        res.json(mesas.map((m) => {
            const ocupadas = ocupadasPorMesa.get(m.id) ?? 0;
            const libres = Math.max(0, m.cantidad - ocupadas);
            return {
                ...m,
                ocupadas,
                libres,
                ocupada: libres <= 0
            };
        }));
    }
    catch (error) {
        console.error('Error consultando disponibilidad de mesas:', error);
        res.status(500).json({ error: 'Error al consultar disponibilidad' });
    }
};
// POST /api/sucursales/:id/mesas  { nombre, puestos, foto }  (dueño/staff/empleado de la sucursal)
export const crearMesa = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        if (!(await esRestaurante(sucursalId))) {
            return res.status(400).json({ error: 'Esta sucursal no permite mesas' });
        }
        const { nombre, puestos, cantidad, foto } = req.body ?? {};
        if (!nombre || String(nombre).trim() === '') {
            return res.status(400).json({ error: 'nombre es requerido' });
        }
        const puestosNum = puestos !== undefined && puestos !== '' ? Number(puestos) : 2;
        if (isNaN(puestosNum) || puestosNum < 1) {
            return res.status(400).json({ error: 'puestos debe ser un número mayor o igual a 1' });
        }
        const cantidadNum = cantidad !== undefined && cantidad !== '' ? Number(cantidad) : 1;
        if (isNaN(cantidadNum) || cantidadNum < 1) {
            return res.status(400).json({ error: 'cantidad debe ser un número mayor o igual a 1' });
        }
        const mesa = await prisma.mesas.create({
            data: {
                sucursal_id: sucursalId,
                nombre: String(nombre).trim(),
                puestos: puestosNum,
                cantidad: cantidadNum,
                foto: foto != null ? String(foto) : null
            }
        });
        res.status(201).json(mesa);
    }
    catch (error) {
        console.error('Error creando mesa:', error);
        res.status(500).json({ error: 'Error al crear la mesa' });
    }
};
// PATCH /api/sucursales/:id/mesas/:mesaId  { nombre?, puestos?, foto? }
export const editarMesa = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const mesaId = Number(req.params.mesaId);
        const existente = await prisma.mesas.findFirst({ where: { id: mesaId, sucursal_id: sucursalId } });
        if (!existente)
            return res.status(404).json({ error: 'Mesa no encontrada' });
        const { nombre, puestos, cantidad, foto, activa } = req.body ?? {};
        const data = {};
        if (nombre !== undefined) {
            if (String(nombre).trim() === '')
                return res.status(400).json({ error: 'nombre no puede estar vacío' });
            data.nombre = String(nombre).trim();
        }
        if (puestos !== undefined) {
            const n = Number(puestos);
            if (isNaN(n) || n < 1)
                return res.status(400).json({ error: 'puestos inválido' });
            data.puestos = n;
        }
        if (cantidad !== undefined) {
            const n = Number(cantidad);
            if (isNaN(n) || n < 1)
                return res.status(400).json({ error: 'cantidad inválida' });
            data.cantidad = n;
        }
        if (foto !== undefined)
            data.foto = foto != null ? String(foto) : null;
        if (activa !== undefined)
            data.activa = activa === true;
        const mesa = await prisma.mesas.update({ where: { id: mesaId }, data });
        res.json(mesa);
    }
    catch (error) {
        console.error('Error editando mesa:', error);
        res.status(500).json({ error: 'Error al editar la mesa' });
    }
};
// DELETE /api/sucursales/:id/mesas/:mesaId  (desactiva la mesa)
export const eliminarMesa = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const mesaId = Number(req.params.mesaId);
        const existente = await prisma.mesas.findFirst({ where: { id: mesaId, sucursal_id: sucursalId } });
        if (!existente)
            return res.status(404).json({ error: 'Mesa no encontrada' });
        await prisma.mesas.update({ where: { id: mesaId }, data: { activa: false } });
        res.json({ message: 'Mesa desactivada.' });
    }
    catch (error) {
        console.error('Error eliminando mesa:', error);
        res.status(500).json({ error: 'Error al eliminar la mesa' });
    }
};
