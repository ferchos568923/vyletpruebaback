import { prisma } from '../services/prisma.js';
import { generarQRPedido, verificarQRPedido } from '../services/qr.service.js';
import { notificarUsuario } from '../services/socket.service.js';
import { verificarAccesoSucursal } from './qr.controller.js';
// Crea un pedido a partir de los platos (texto "2x Ceviche, 1x Jugo") de una
// reserva confirmada. Idempotente: si ya existe pedido para la reserva, lo devuelve.
// Retorna el pedido_id o null si no había platos que enviar.
export const crearPedidoDesdeReserva = async (reservaId) => {
    try {
        const reserva = await prisma.reservas.findUnique({ where: { id: reservaId } });
        if (!reserva || !reserva.platos || !reserva.platos.trim())
            return null;
        const existente = await prisma.pedidos.findFirst({ where: { reserva_id: reservaId } });
        if (existente)
            return existente.id;
        const partes = reserva.platos.split(',').map((s) => s.trim()).filter(Boolean);
        const productos = await prisma.productos_servicios.findMany({
            where: { sucursal_id: reserva.sucursal_id, activo: true },
            select: { id: true, nombre: true, precio: true, precio_oferta: true }
        });
        const porNombre = new Map(productos.map((p) => [p.nombre.toLowerCase().trim(), p]));
        const detalle = [];
        const sinMatch = [];
        for (const parte of partes) {
            const m = parte.match(/^(\d+)\s*x\s*(.+)$/i);
            if (!m) {
                sinMatch.push(parte);
                continue;
            }
            const cant = Math.min(20, Math.max(1, parseInt(m[1], 10)));
            const prod = porNombre.get(m[2].toLowerCase().trim());
            if (!prod) {
                sinMatch.push(parte);
                continue;
            }
            detalle.push({
                producto_id: prod.id,
                cantidad: cant,
                precio_unitario: Number(prod.precio_oferta ?? prod.precio ?? 0),
                nota: null
            });
        }
        const total = detalle.reduce((s, d) => s + d.precio_unitario * d.cantidad, 0);
        const notasExtras = [
            `Pedido de reserva #${reserva.id}`,
            sinMatch.length > 0 ? `No encontrados en menú: ${sinMatch.join(', ')}` : null,
            reserva.observaciones ? `Obs. reserva: ${reserva.observaciones}` : null
        ].filter(Boolean).join(' | ');
        const pedido = await prisma.pedidos.create({
            data: {
                sucursal_id: reserva.sucursal_id,
                mesa_id: reserva.mesa_id,
                reserva_id: reserva.id,
                usuario_id: reserva.usuario_id,
                cliente_nombre: reserva.cliente_nombre,
                cliente_telefono: reserva.cliente_telefono,
                estado: 'pendiente',
                total,
                notas: notasExtras || null,
                pedido_detalle: { create: detalle }
            }
        });
        return pedido.id;
    }
    catch (e) {
        console.error('Error creando pedido desde reserva:', e);
        return null;
    }
};
export const ESTADOS_PEDIDO = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'];
export const ESTADOS_DETALLE = ['pendiente', 'preparando', 'listo', 'entregado'];
const pedidoInclude = {
    pedido_detalle: {
        include: {
            productos_servicios: { select: { id: true, nombre: true, imagen_principal: true, tipo: true } }
        },
        orderBy: { id: 'asc' }
    },
    mesas: { select: { id: true, nombre: true } },
    sucursales: { select: { id: true, nombre: true } },
    reservas: { select: { id: true, fecha_reserva: true, hora_inicio: true, cantidad_personas: true, cliente_nombre: true, estado: true } },
    usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true } }
};
const formatearPedido = (p) => ({
    id: p.id,
    sucursal_id: p.sucursal_id,
    sucursal: p.sucursales?.nombre ?? null,
    mesa_id: p.mesa_id,
    mesa: p.mesas?.nombre ?? null,
    reserva_id: p.reserva_id,
    cliente_nombre: p.cliente_nombre,
    cliente_telefono: p.cliente_telefono,
    usuario: p.usuarios ? {
        id: p.usuarios.id,
        nombre: `${p.usuarios.nombres} ${p.usuarios.apellidos || ''}`.trim(),
        correo: p.usuarios.correo
    } : null,
    estado: p.estado,
    total: Number(p.total ?? 0),
    notas: p.notas,
    fecha_creacion: p.fecha_creacion,
    reserva: p.reservas ? {
        id: p.reservas.id,
        fecha: p.reservas.fecha_reserva,
        hora: p.reservas.hora_inicio,
        personas: p.reservas.cantidad_personas,
        cliente: p.reservas.cliente_nombre,
        estado: p.reservas.estado
    } : null,
    items: (p.pedido_detalle ?? []).map((d) => ({
        id: d.id,
        producto_id: d.producto_id,
        nombre: d.productos_servicios?.nombre ?? 'Producto',
        imagen: d.productos_servicios?.imagen_principal ?? null,
        tipo: d.productos_servicios?.tipo ?? null,
        cantidad: d.cantidad,
        precio_unitario: Number(d.precio_unitario ?? 0),
        subtotal: Number(d.precio_unitario ?? 0) * (d.cantidad ?? 0),
        nota: d.nota,
        estado: d.estado
    }))
});
// GET /api/sucursales/:id/pedidos?estado=pendiente  (dueño/staff/empleado)
export const listarPedidos = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const { estado } = req.query;
        const where = { sucursal_id: sucursalId };
        if (estado && ESTADOS_PEDIDO.includes(String(estado)))
            where.estado = String(estado);
        const pedidos = await prisma.pedidos.findMany({
            where,
            include: pedidoInclude,
            orderBy: { id: 'desc' },
            take: 200
        });
        res.json(pedidos.map(formatearPedido));
    }
    catch (error) {
        console.error('Error listando pedidos:', error);
        res.status(500).json({ error: 'Error al listar pedidos' });
    }
};
// GET /api/pedidos/:id  (público: para que el cliente vea el estado de su pedido)
export const obtenerPedido = async (req, res) => {
    try {
        const pedidoId = Number(req.params.id);
        const pedido = await prisma.pedidos.findUnique({ where: { id: pedidoId }, include: pedidoInclude });
        if (!pedido)
            return res.status(404).json({ error: 'Pedido no encontrado' });
        res.json(formatearPedido(pedido));
    }
    catch (error) {
        console.error('Error obteniendo pedido:', error);
        res.status(500).json({ error: 'Error al obtener pedido' });
    }
};
// POST /api/sucursales/:id/pedidos  (público; usuario opcional)
// body: { mesa_token?, mesa_id?, reserva_id?, cliente_nombre?, cliente_telefono?, notas?, items: [{ producto_id, cantidad, nota? }] }
export const crearPedido = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const { mesa_token, mesa_id, reserva_id, cliente_nombre, cliente_telefono, notas, items } = req.body ?? {};
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'El pedido debe tener al menos un producto' });
        }
        if (items.length > 50)
            return res.status(400).json({ error: 'Máximo 50 líneas por pedido' });
        const sucursal = await prisma.sucursales.findUnique({
            where: { id: sucursalId },
            select: { id: true, activo: true, empresa_id: true, nombre: true }
        });
        if (!sucursal || !sucursal.activo)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        // Validar mesa (por token preferido, o por id)
        let mesaId = null;
        if (mesa_token) {
            const mesa = await prisma.mesas.findUnique({ where: { qr_token: String(mesa_token) } });
            if (!mesa || mesa.sucursal_id !== sucursalId || !mesa.activa) {
                return res.status(400).json({ error: 'Mesa inválida' });
            }
            mesaId = mesa.id;
        }
        else if (mesa_id) {
            const mesa = await prisma.mesas.findFirst({ where: { id: Number(mesa_id), sucursal_id: sucursalId, activa: true } });
            if (!mesa)
                return res.status(400).json({ error: 'Mesa inválida' });
            mesaId = mesa.id;
        }
        // Validar reserva opcional; si no se indica y la mesa tiene reserva hoy, vincularla
        let reservaId = null;
        if (reserva_id) {
            const reserva = await prisma.reservas.findFirst({
                where: { id: Number(reserva_id), sucursal_id: sucursalId, estado: { not: 'cancelada' } }
            });
            if (!reserva)
                return res.status(400).json({ error: 'Reserva inválida' });
            reservaId = reserva.id;
        }
        else if (mesaId) {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const manana = new Date(hoy);
            manana.setDate(hoy.getDate() + 1);
            const reservaHoy = await prisma.reservas.findFirst({
                where: {
                    mesa_id: mesaId,
                    sucursal_id: sucursalId,
                    fecha_reserva: { gte: hoy, lt: manana },
                    estado: { in: ['pendiente', 'confirmada'] }
                },
                orderBy: { hora_inicio: 'asc' }
            });
            if (reservaHoy)
                reservaId = reservaHoy.id;
        }
        // Validar productos y calcular total en servidor
        const productoIds = [...new Set(items.map((i) => Number(i.producto_id)).filter((n) => !isNaN(n)))];
        if (productoIds.length === 0)
            return res.status(400).json({ error: 'Productos inválidos' });
        const productos = await prisma.productos_servicios.findMany({
            where: { id: { in: productoIds }, sucursal_id: sucursalId, activo: true, disponible: true },
            select: { id: true, precio: true, precio_oferta: true }
        });
        const precioPorId = new Map(productos.map((p) => [p.id, Number(p.precio_oferta ?? p.precio ?? 0)]));
        const detalle = [];
        for (const it of items) {
            const pid = Number(it.producto_id);
            const cant = Math.floor(Number(it.cantidad));
            if (!precioPorId.has(pid) || isNaN(cant) || cant < 1 || cant > 20) {
                return res.status(400).json({ error: `Producto o cantidad inválida (id ${it.producto_id})` });
            }
            detalle.push({
                producto_id: pid,
                cantidad: cant,
                precio_unitario: precioPorId.get(pid),
                nota: it.nota ? String(it.nota).slice(0, 300) : null
            });
        }
        const total = detalle.reduce((s, d) => s + d.precio_unitario * d.cantidad, 0);
        const usuarioId = req.user?.id ?? null;
        const pedido = await prisma.pedidos.create({
            data: {
                sucursal_id: sucursalId,
                mesa_id: mesaId,
                reserva_id: reservaId,
                usuario_id: usuarioId,
                cliente_nombre: cliente_nombre ? String(cliente_nombre).slice(0, 200) : null,
                cliente_telefono: cliente_telefono ? String(cliente_telefono).slice(0, 30) : null,
                notas: notas ? String(notas).slice(0, 1000) : null,
                estado: 'pendiente',
                total,
                pedido_detalle: { create: detalle }
            },
            include: pedidoInclude
        });
        res.status(201).json(formatearPedido(pedido));
        // Notificar a los dueños de la empresa por WebSocket (no bloquea respuesta)
        try {
            const duenos = await prisma.usuario_empresas.findMany({
                where: { empresa_id: sucursal.empresa_id },
                select: { usuario_id: true }
            });
            for (const d of duenos) {
                const notif = await prisma.notificaciones.create({
                    data: {
                        usuario_id: d.usuario_id,
                        tipo: 'nuevo_pedido',
                        titulo: 'Nuevo pedido en mesa',
                        mensaje: `Pedido #${pedido.id} en ${sucursal.nombre}${mesaId ? '' : ''} por $${Number(total).toFixed(2)}`,
                        enlace: `/admin/sucursales/${sucursalId}/pedidos`
                    }
                });
                notificarUsuario(d.usuario_id, { tipo: 'nuevo_pedido', notificacion: notif });
            }
        }
        catch (e) {
            console.error('Error notificando nuevo pedido:', e);
        }
    }
    catch (error) {
        console.error('Error creando pedido:', error);
        res.status(500).json({ error: 'Error al crear el pedido' });
    }
};
// PATCH /api/pedidos/:id/estado  { estado }  (dueño/staff/empleado)
export const cambiarEstadoPedido = async (req, res) => {
    try {
        const pedidoId = Number(req.params.id);
        const { estado } = req.body ?? {};
        if (!ESTADOS_PEDIDO.includes(estado)) {
            return res.status(400).json({ error: `Estado inválido. Use: ${ESTADOS_PEDIDO.join(', ')}` });
        }
        const pedido = await prisma.pedidos.findUnique({
            where: { id: pedidoId },
            select: { id: true, sucursal_id: true, usuario_id: true, estado: true, total: true }
        });
        if (!pedido)
            return res.status(404).json({ error: 'Pedido no encontrado' });
        if (!await verificarAccesoSucursal(req.user.id, pedido.sucursal_id)) {
            return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
        }
        const actualizado = await prisma.pedidos.update({
            where: { id: pedidoId },
            data: { estado, fecha_actualizacion: new Date() },
            include: pedidoInclude
        });
        res.json(formatearPedido(actualizado));
        // Notificar al cliente (si tiene cuenta)
        if (pedido.usuario_id) {
            try {
                const mensajes = {
                    preparando: `Tu pedido #${pedidoId} se está preparando 👨‍🍳`,
                    listo: `Tu pedido #${pedidoId} está listo ✅`,
                    entregado: `Tu pedido #${pedidoId} fue entregado. ¡Buen provecho! 🍽️`,
                    cancelado: `Tu pedido #${pedidoId} fue cancelado`
                };
                if (mensajes[estado]) {
                    const notif = await prisma.notificaciones.create({
                        data: {
                            usuario_id: pedido.usuario_id,
                            tipo: 'pedido_estado',
                            titulo: 'Tu pedido cambió de estado',
                            mensaje: mensajes[estado],
                            enlace: `/pedido/${pedidoId}`
                        }
                    });
                    notificarUsuario(pedido.usuario_id, { tipo: 'pedido_estado', notificacion: notif });
                }
            }
            catch (e) {
                console.error('Error notificando cambio de pedido:', e);
            }
        }
    }
    catch (error) {
        console.error('Error cambiando estado de pedido:', error);
        res.status(500).json({ error: 'Error al cambiar estado' });
    }
};
// PATCH /api/pedidos/detalle/:detalleId/estado  { estado }  (dueño/staff/empleado)
export const cambiarEstadoDetalle = async (req, res) => {
    try {
        const detalleId = Number(req.params.detalleId);
        const { estado } = req.body ?? {};
        if (!ESTADOS_DETALLE.includes(estado)) {
            return res.status(400).json({ error: `Estado inválido. Use: ${ESTADOS_DETALLE.join(', ')}` });
        }
        const detalle = await prisma.pedido_detalle.findUnique({
            where: { id: detalleId },
            include: { pedidos: { select: { id: true, sucursal_id: true } } }
        });
        if (!detalle)
            return res.status(404).json({ error: 'Item no encontrado' });
        if (!await verificarAccesoSucursal(req.user.id, detalle.pedidos.sucursal_id)) {
            return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
        }
        await prisma.pedido_detalle.update({ where: { id: detalleId }, data: { estado } });
        // Si todos los items están entregados, marcar pedido como entregado
        // Si al menos uno está en preparación o más, avanzar el pedido
        const items = await prisma.pedido_detalle.findMany({
            where: { pedido_id: detalle.pedidos.id },
            select: { estado: true }
        });
        const estados = items.map((i) => i.estado);
        let nuevoEstadoPedido = null;
        if (estados.length > 0 && estados.every((e) => e === 'entregado'))
            nuevoEstadoPedido = 'entregado';
        else if (estados.some((e) => e === 'listo'))
            nuevoEstadoPedido = 'listo';
        else if (estados.some((e) => e === 'preparando'))
            nuevoEstadoPedido = 'preparando';
        if (nuevoEstadoPedido) {
            await prisma.pedidos.update({
                where: { id: detalle.pedidos.id },
                data: { estado: nuevoEstadoPedido, fecha_actualizacion: new Date() }
            });
        }
        const pedido = await prisma.pedidos.findUnique({ where: { id: detalle.pedidos.id }, include: pedidoInclude });
        res.json(formatearPedido(pedido));
    }
    catch (error) {
        console.error('Error cambiando estado de item:', error);
        res.status(500).json({ error: 'Error al cambiar estado del item' });
    }
};
// POST /api/pedidos/:id/generar-qr  (dueño del pedido; público si el pedido es anónimo)
export const generarQRPedidoCtrl = async (req, res) => {
    try {
        const pedidoId = Number(req.params.id);
        const pedido = await prisma.pedidos.findUnique({
            where: { id: pedidoId },
            include: { mesas: { select: { nombre: true } }, sucursales: { select: { nombre: true } } }
        });
        if (!pedido)
            return res.status(404).json({ error: 'Pedido no encontrado' });
        if (pedido.estado === 'cancelado')
            return res.status(400).json({ error: 'Pedido cancelado' });
        if (pedido.estado === 'entregado')
            return res.status(400).json({ error: 'Pedido ya entregado' });
        // Si el pedido tiene dueño con cuenta, solo él puede generar el QR
        if (pedido.usuario_id && req.user?.id !== pedido.usuario_id) {
            return res.status(403).json({ error: 'No autorizado' });
        }
        const token = generarQRPedido(pedidoId);
        res.json({
            token,
            qr_data: `VYLET-QR:${token}`,
            pedido: {
                id: pedidoId,
                sucursal: pedido.sucursales?.nombre,
                mesa: pedido.mesas?.nombre ?? null,
                total: Number(pedido.total ?? 0)
            },
            expira_en: '5 minutos'
        });
    }
    catch (error) {
        console.error('Error generando QR pedido:', error);
        res.status(500).json({ error: 'Error al generar QR' });
    }
};
// POST /api/pedidos/verificar-qr  { token }  (empleado autenticado)
export const verificarQRPedidoCtrl = async (req, res) => {
    try {
        const { token } = req.body;
        if (!token)
            return res.status(400).json({ error: 'Token requerido' });
        const payload = verificarQRPedido(token);
        if (!payload) {
            return res.status(400).json({ error: 'QR inválido o expirado', codigo: 'QR_EXPIRADO' });
        }
        const pedido = await prisma.pedidos.findUnique({ where: { id: payload.pid }, include: pedidoInclude });
        if (!pedido)
            return res.status(404).json({ error: 'Pedido no encontrado' });
        if (!await verificarAccesoSucursal(req.user.id, pedido.sucursal_id)) {
            return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
        }
        res.json({ valido: true, tipo: 'pedido', pedido: formatearPedido(pedido) });
    }
    catch (error) {
        console.error('Error verificando QR pedido:', error);
        res.status(500).json({ error: 'Error al verificar QR' });
    }
};
