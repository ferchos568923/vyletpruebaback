import { prisma } from '../services/prisma.js';
import { canGestionarSucursal, isStaff } from '../middlewares/auth.js';
import { permiteCupones } from '../services/planes.service.js';
import { estadoAbierto } from '../services/horario.service.js';
const parseFecha = (v) => (v === undefined || v === null || v === '' ? undefined : new Date(String(v)));
const parseNum = (v) => {
    if (v === undefined)
        return undefined;
    if (v === null || v === '')
        return null;
    return Number(v);
};
const buildData = (body) => {
    const data = {};
    const campos = ['titulo', 'descripcion', 'imagen', 'codigo', 'tipo_descuento'];
    for (const c of campos)
        if (body[c] !== undefined)
            data[c] = body[c];
    if (body.valor_descuento !== undefined)
        data.valor_descuento = Number(body.valor_descuento);
    if (body.monto_minimo !== undefined)
        data.monto_minimo = parseNum(body.monto_minimo);
    if (body.fecha_inicio !== undefined)
        data.fecha_inicio = body.fecha_inicio === '' ? null : parseFecha(body.fecha_inicio);
    if (body.fecha_fin !== undefined)
        data.fecha_fin = body.fecha_fin === '' ? null : parseFecha(body.fecha_fin);
    if (body.cantidad_usos !== undefined)
        data.cantidad_usos = parseNum(body.cantidad_usos);
    return data;
};
const verificarSucursal = async (req, res) => {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId } });
    if (!sucursal) {
        res.status(404).json({ error: 'Sucursal no encontrada' });
        return null;
    }
    if (!(await canGestionarSucursal(req, sucursal))) {
        res.status(403).json({ error: 'No puedes gestionar esta sucursal' });
        return null;
    }
    return sucursal;
};
// GET /api/sucursales/:id/cupones  (público: activos y vigentes)
export const listPublic = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const cupones = await prisma.cupones.findMany({
            where: { sucursal_id: id, activo: true },
            orderBy: { fecha_creacion: 'desc' }
        });
        const hoy = new Date();
        const vigentes = cupones.filter((c) => {
            const okFecha = (!c.fecha_inicio || new Date(c.fecha_inicio) <= hoy) &&
                (!c.fecha_fin || new Date(c.fecha_fin) >= hoy);
            const okUsos = c.cantidad_usos === null || c.cantidad_usos === undefined || (c.usos_realizados ?? 0) < c.cantidad_usos;
            return okFecha && okUsos;
        });
        res.json(vigentes);
    }
    catch (error) {
        console.error('Error listando cupones:', error);
        res.status(500).json({ error: 'Error al listar cupones' });
    }
};
// GET /api/sucursales/:id/cupones/todos  (panel)
export const adminList = async (req, res) => {
    try {
        const sucursal = await verificarSucursal(req, res);
        if (!sucursal)
            return;
        const cupones = await prisma.cupones.findMany({
            where: { sucursal_id: sucursal.id },
            orderBy: { fecha_creacion: 'desc' }
        });
        res.json(cupones);
    }
    catch (error) {
        console.error('Error listando cupones (admin):', error);
        res.status(500).json({ error: 'Error al listar cupones' });
    }
};
// POST /api/sucursales/:id/cupones
export const adminCreate = async (req, res) => {
    try {
        const sucursal = await verificarSucursal(req, res);
        if (!sucursal)
            return;
        if (!isStaff(req) && !(await permiteCupones(sucursal.empresa_id))) {
            return res.status(403).json({ error: 'Los cupones solo están disponibles en el plan Premium o superior. Actualiza tu plan.' });
        }
        const { titulo, valor_descuento, tipo_descuento } = req.body;
        if (!titulo || valor_descuento === undefined || !tipo_descuento) {
            return res.status(400).json({ error: 'titulo, tipo_descuento y valor_descuento son requeridos' });
        }
        if (!['porcentaje', 'monto'].includes(tipo_descuento)) {
            return res.status(400).json({ error: 'tipo_descuento debe ser porcentaje o monto' });
        }
        const cupon = await prisma.cupones.create({
            data: {
                sucursal_id: sucursal.id,
                ...buildData(req.body),
                activo: true,
                usos_realizados: 0
            }
        });
        res.status(201).json(cupon);
    }
    catch (error) {
        console.error('Error creando cupón:', error);
        res.status(500).json({ error: 'Error al crear cupón' });
    }
};
// PATCH /api/sucursales/:id/cupones/:cuponId
export const adminUpdate = async (req, res) => {
    try {
        const sucursal = await verificarSucursal(req, res);
        if (!sucursal)
            return;
        const cuponId = Number(req.params.cuponId);
        const cupon = await prisma.cupones.findFirst({ where: { id: cuponId, sucursal_id: sucursal.id } });
        if (!cupon)
            return res.status(404).json({ error: 'Cupón no encontrado' });
        const actualizado = await prisma.cupones.update({ where: { id: cuponId }, data: buildData(req.body) });
        res.json(actualizado);
    }
    catch (error) {
        console.error('Error actualizando cupón:', error);
        res.status(500).json({ error: 'Error al actualizar cupón' });
    }
};
// DELETE /api/sucursales/:id/cupones/:cuponId  (soft)
export const adminRemove = async (req, res) => {
    try {
        const sucursal = await verificarSucursal(req, res);
        if (!sucursal)
            return;
        const cuponId = Number(req.params.cuponId);
        const cupon = await prisma.cupones.findFirst({ where: { id: cuponId, sucursal_id: sucursal.id } });
        if (!cupon)
            return res.status(404).json({ error: 'Cupón no encontrado' });
        await prisma.cupones.update({ where: { id: cuponId }, data: { activo: false } });
        res.json({ message: 'Cupón desactivado' });
    }
    catch (error) {
        console.error('Error eliminando cupón:', error);
        res.status(500).json({ error: 'Error al eliminar cupón' });
    }
};
// GET /api/sucursales/:id/cupones/canjes  (panel: quién canjeó cada cupón)
export const adminCanjes = async (req, res) => {
    try {
        const sucursal = await verificarSucursal(req, res);
        if (!sucursal)
            return;
        const canjes = await prisma.cupones_usuario.findMany({
            where: { cupones: { sucursal_id: sucursal.id } },
            orderBy: { fecha_uso: 'desc' },
            include: {
                cupones: { select: { id: true, titulo: true, codigo: true, tipo_descuento: true, valor_descuento: true } },
                usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true, telefono: true, cedula: true } }
            }
        });
        res.json(canjes);
    }
    catch (error) {
        console.error('Error listando canjes:', error);
        res.status(500).json({ error: 'Error al listar canjes' });
    }
};
// POST /api/cupones/:id/canjear  (cliente autenticado)
export const canjear = async (req, res) => {
    try {
        const cuponId = Number(req.params.id);
        const cupon = await prisma.cupones.findUnique({ where: { id: cuponId } });
        if (!cupon || !cupon.activo)
            return res.status(404).json({ error: 'Cupón no encontrado' });
        if (cupon.sucursal_id) {
            const sucursalCupon = await prisma.sucursales.findUnique({ where: { id: cupon.sucursal_id }, select: { horario: true, activo: true } });
            if (!sucursalCupon || !sucursalCupon.activo)
                return res.status(404).json({ error: 'Sucursal no encontrada' });
            if (estadoAbierto(sucursalCupon.horario) === 'cerrado') {
                return res.status(409).json({ error: 'Este negocio está cerrado en este momento. Podrás canjear cuando esté abierto.' });
            }
        }
        const hoy = new Date();
        if (cupon.fecha_inicio && new Date(cupon.fecha_inicio) > hoy) {
            return res.status(400).json({ error: 'Este cupón aún no está vigente' });
        }
        if (cupon.fecha_fin && new Date(cupon.fecha_fin) < hoy) {
            return res.status(400).json({ error: 'Este cupón ya expiró' });
        }
        if (cupon.cantidad_usos !== null && cupon.cantidad_usos !== undefined && (cupon.usos_realizados ?? 0) >= cupon.cantidad_usos) {
            return res.status(400).json({ error: 'Este cupón ya no tiene cupos disponibles' });
        }
        const yaCanjeado = await prisma.cupones_usuario.findFirst({
            where: { cupon_id: cuponId, usuario_id: req.user.id }
        });
        if (yaCanjeado)
            return res.status(400).json({ error: 'Ya canjeaste este cupón' });
        await prisma.$transaction([
            prisma.cupones_usuario.create({ data: { cupon_id: cuponId, usuario_id: req.user.id } }),
            prisma.cupones.update({ where: { id: cuponId }, data: { usos_realizados: { increment: 1 } } })
        ]);
        res.json({ message: 'Cupón canjeado correctamente' });
    }
    catch (error) {
        console.error('Error canjeando cupón:', error);
        res.status(500).json({ error: 'Error al canjear cupón' });
    }
};
// GET /api/mis-cupones  (cliente autenticado)
export const misCupones = async (req, res) => {
    try {
        const cupones = await prisma.cupones_usuario.findMany({
            where: { usuario_id: req.user.id },
            orderBy: { fecha_uso: 'desc' },
            include: {
                cupones: {
                    include: {
                        sucursales: { include: { ciudades: { select: { nombre: true } }, empresas: { select: { id: true, nombre: true } } } }
                    }
                }
            }
        });
        res.json(cupones);
    }
    catch (error) {
        console.error('Error listando mis cupones:', error);
        res.status(500).json({ error: 'Error al listar mis cupones' });
    }
};
