import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { canGestionarSucursal, isStaff } from '../middlewares/auth.js';
import { permiteCartillasPorCedula } from '../services/planes.service.js';
import { generarQRCartilla, verificarQRCartilla } from '../services/qr.service.js';
import { verificarAccesoSucursal } from './qr.controller.js';
import { notificarUsuario } from '../services/socket.service.js';

// GET /api/sucursales/:id/cartilla  (público: ver si la sucursal tiene cartilla activa)
export const verConfig = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const config = await prisma.cartilla_config.findUnique({ where: { sucursal_id: sucursalId } });
    if (!config || !config.activo) return res.status(404).json({ error: 'Esta sucursal no tiene cartilla de fidelización' });
    res.json({ id: config.id, titulo: config.titulo, descripcion: config.descripcion, sellos_requeridos: config.sellos_requeridos, premio: config.premio });
  } catch (error) {
    console.error('Error viendo cartilla:', error);
    res.status(500).json({ error: 'Error al ver cartilla' });
  }
};

// GET /api/sucursales/:id/cartilla/admin  (dueño: ver config completa + stats)
export const adminVer = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId }, select: { id: true, empresa_id: true } });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await canGestionarSucursal(req, sucursal))) return res.status(403).json({ error: 'No puedes gestionar esta sucursal' });

    const config = await prisma.cartilla_config.findUnique({
      where: { sucursal_id: sucursalId },
      include: { _count: { select: { cartilla_cliente: true } } },
    });
    if (!config) return res.json(null);
    const [completadas, canjeadas] = await Promise.all([
      prisma.cartilla_cliente.count({ where: { config_id: config.id, estado: 'completada' } }),
      prisma.cartilla_cliente.count({ where: { config_id: config.id, estado: 'canjeada' } }),
    ]);
    res.json({ ...config, total_cartillas: config._count.cartilla_cliente, completadas, canjeadas });
  } catch (error) {
    console.error('Error viendo config cartilla:', error);
    res.status(500).json({ error: 'Error al ver configuración' });
  }
};

// POST /api/sucursales/:id/cartilla  (dueño: crear o actualizar config)
export const adminGuardar = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId }, select: { id: true, empresa_id: true } });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await canGestionarSucursal(req, sucursal))) return res.status(403).json({ error: 'No puedes gestionar esta sucursal' });

    if (!isStaff(req)) {
      const usuario = await prisma.usuarios.findUnique({ where: { id: req.user.id }, select: { cedula: true } });
      const cedula = usuario?.cedula ?? '';
      if (cedula && !(await permiteCartillasPorCedula(cedula))) {
        return res.status(403).json({ error: 'Las cartillas solo están disponibles en el plan Premium o superior. Actualiza tu plan.' });
      }
    }

    const { titulo, descripcion, sellos_requeridos, premio, activo } = req.body ?? {};
    const sellos = Number(sellos_requeridos);
    if (!sellos || sellos < 2 || sellos > 50) return res.status(400).json({ error: 'La meta debe ser entre 2 y 50 sellos' });
    if (!premio || !String(premio).trim()) return res.status(400).json({ error: 'El premio es requerido' });

    const config = await prisma.cartilla_config.upsert({
      where: { sucursal_id: sucursalId },
      create: {
        sucursal_id: sucursalId,
        titulo: titulo?.trim() || 'Cartilla de fidelización',
        descripcion: descripcion?.trim() || null,
        sellos_requeridos: sellos,
        premio: String(premio).trim(),
        activo: activo !== false,
      },
      update: {
        titulo: titulo?.trim() || 'Cartilla de fidelización',
        descripcion: descripcion?.trim() || null,
        sellos_requeridos: sellos,
        premio: String(premio).trim(),
        activo: activo !== false,
      },
    });
    res.json(config);
  } catch (error) {
    console.error('Error guardando cartilla:', error);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
};

// GET /api/sucursales/:id/cartilla/sellos  (dueño/empleado: historial de sellos)
export const adminSellos = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });

    const config = await prisma.cartilla_config.findUnique({ where: { sucursal_id: sucursalId } });
    if (!config) return res.json([]);
    const sellos = await prisma.cartilla_sello.findMany({
      where: { cartilla_cliente: { config_id: config.id } },
      include: {
        cartilla_cliente: { include: { usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true } } } },
        usuarios: { select: { id: true, nombres: true, apellidos: true } },
      },
      orderBy: { fecha: 'desc' },
      take: 100,
    });
    res.json(sellos);
  } catch (error) {
    console.error('Error listando sellos:', error);
    res.status(500).json({ error: 'Error al listar sellos' });
  }
};

// GET /api/mis-cartillas  (cliente: mis cartillas)
export const misCartillas = async (req: Request, res: Response) => {
  try {
    const cartillas = await prisma.cartilla_cliente.findMany({
      where: { usuario_id: req.user.id },
      include: {
        cartilla_config: {
          include: { sucursales: { select: { id: true, nombre: true, imagen_principal: true, empresas: { select: { nombre: true } } } } },
        },
      },
      orderBy: { fecha_creacion: 'desc' },
    });
    res.json(cartillas);
  } catch (error) {
    console.error('Error listando mis cartillas:', error);
    res.status(500).json({ error: 'Error al listar cartillas' });
  }
};

// POST /api/sucursales/:id/cartilla/unirse  (cliente: crear mi cartilla en sucursal con config activa)
export const unirse = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const config = await prisma.cartilla_config.findUnique({ where: { sucursal_id: sucursalId } });
    if (!config || !config.activo) return res.status(404).json({ error: 'Esta sucursal no tiene cartilla activa' });

    let cartilla = await prisma.cartilla_cliente.findFirst({
      where: { config_id: config.id, usuario_id: req.user.id, estado: 'activa' },
      include: { cartilla_config: true },
    });
    if (!cartilla) {
      cartilla = await prisma.cartilla_cliente.create({
        data: { config_id: config.id, usuario_id: req.user.id },
        include: { cartilla_config: true },
      });
    }
    res.status(201).json(cartilla);
  } catch (error) {
    console.error('Error unirse a cartilla:', error);
    res.status(500).json({ error: 'Error al unirse' });
  }
};

// POST /api/cartillas/:id/generar-qr  (cliente: mi QR para que el empleado escanee)
export const generarQR = async (req: Request, res: Response) => {
  try {
    const cartillaId = Number(req.params.id);
    const cartilla = await prisma.cartilla_cliente.findUnique({
      where: { id: cartillaId },
      include: { cartilla_config: { include: { sucursales: { select: { id: true, nombre: true } } } } },
    });
    if (!cartilla) return res.status(404).json({ error: 'Cartilla no encontrada' });
    if (cartilla.usuario_id !== req.user.id) return res.status(403).json({ error: 'No autorizado' });
    if (cartilla.estado !== 'activa') return res.status(400).json({ error: 'Cartilla ya completada' });
    if (!cartilla.cartilla_config.activo) return res.status(400).json({ error: 'Cartilla desactivada por el negocio' });

    const token = generarQRCartilla(req.user.id, cartilla.id);
    res.json({
      token,
      qr_data: `VYLET-QR:${token}`,
      cartilla: {
        sellos: cartilla.sellos,
        meta: cartilla.cartilla_config.sellos_requeridos,
        sucursal: cartilla.cartilla_config.sucursales.nombre,
      },
      expira_en: '5 minutos',
    });
  } catch (error) {
    console.error('Error generando QR cartilla:', error);
    res.status(500).json({ error: 'Error al generar QR' });
  }
};

// POST /api/cartillas/verificar-qr  (empleado: { token })
export const verificarQR = async (req: Request, res: Response) => {
  try {
    const { token } = req.body ?? {};
    if (!token) return res.status(400).json({ error: 'Token requerido' });
    const payload = verificarQRCartilla(String(token).replace('VYLET-QR:', ''));
    if (!payload) return res.status(400).json({ error: 'QR inválido o expirado', code: 'QR_EXPIRADO' });

    const cartilla = await prisma.cartilla_cliente.findUnique({
      where: { id: payload.cid },
      include: {
        cartilla_config: { include: { sucursales: { select: { id: true, nombre: true } } } },
        usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true, cedula: true } },
      },
    });
    if (!cartilla || cartilla.usuario_id !== payload.uid) return res.status(404).json({ error: 'Cartilla no encontrada' });
    if (cartilla.estado === 'canjeada') return res.status(400).json({ error: 'Premio ya entregado' });
    if (cartilla.estado !== 'activa') return res.status(400).json({ error: 'Cartilla ya completada' });

    const sucursalId = cartilla.cartilla_config.sucursales.id;
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });

    res.json({
      valido: true,
      cartilla_id: cartilla.id,
      cliente: cartilla.usuarios,
      sellos: cartilla.sellos,
      meta: cartilla.cartilla_config.sellos_requeridos,
      titulo: cartilla.cartilla_config.titulo,
      premio: cartilla.cartilla_config.premio,
      sucursal: cartilla.cartilla_config.sucursales.nombre,
      sucursal_id: sucursalId,
    });
  } catch (error) {
    console.error('Error verificando QR cartilla:', error);
    res.status(500).json({ error: 'Error al verificar QR' });
  }
};

// POST /api/cartillas/confirmar-sello  (empleado: { cartilla_id })
export const confirmarSello = async (req: Request, res: Response) => {
  try {
    const { cartilla_id } = req.body ?? {};
    const cartillaId = Number(cartilla_id);
    if (!cartillaId) return res.status(400).json({ error: 'cartilla_id requerido' });

    const cartilla = await prisma.cartilla_cliente.findUnique({
      where: { id: cartillaId },
      include: { cartilla_config: { include: { sucursales: { select: { id: true, nombre: true } } } } },
    });
    if (!cartilla) return res.status(404).json({ error: 'Cartilla no encontrada' });
    if (cartilla.estado !== 'activa') return res.status(400).json({ error: 'Cartilla ya completada' });

    const sucursalId = cartilla.cartilla_config.sucursales.id;
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });

    const nuevosSellos = cartilla.sellos + 1;
    const meta = cartilla.cartilla_config.sellos_requeridos;
    const completada = nuevosSellos >= meta;

    const actualizada = await prisma.$transaction(async (tx) => {
      const c = await tx.cartilla_cliente.update({
        where: { id: cartillaId },
        data: {
          sellos: nuevosSellos,
          estado: completada ? 'completada' : 'activa',
          fecha_completada: completada ? new Date() : null,
        },
      });
      await tx.cartilla_sello.create({ data: { cartilla_id: cartillaId, empleado_id: req.user.id } });
      return c;
    });

    const titulo = completada
      ? `¡Cartilla completada en ${cartilla.cartilla_config.sucursales.nombre}!`
      : `Nuevo sello en ${cartilla.cartilla_config.sucursales.nombre} (${nuevosSellos}/${meta})`;
    await prisma.notificaciones.create({
      data: {
        usuario_id: cartilla.usuario_id,
        tipo: 'cartilla',
        titulo,
        mensaje: completada
          ? `Reclama tu premio: ${cartilla.cartilla_config.premio}`
          : `Te ${meta - nuevosSellos === 1 ? 'falta 1 sello' : `faltan ${meta - nuevosSellos} sellos`} para tu premio`,
        enlace: '/mis-cartillas',
        leido: false,
      },
    });
    notificarUsuario(cartilla.usuario_id, { tipo: 'cartilla', titulo, enlace: '/mis-cartillas' });

    res.json({ sellos: actualizada.sellos, meta, completada, premio: completada ? cartilla.cartilla_config.premio : null });
  } catch (error) {
    console.error('Error confirmando sello:', error);
    res.status(500).json({ error: 'Error al confirmar sello' });
  }
};

// GET /api/sucursales/:id/cartilla/cartillas?estado=activa|completada|canjeada  (dueño/empleado: tabla de cartillas)
export const adminCartillas = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });

    const config = await prisma.cartilla_config.findUnique({ where: { sucursal_id: sucursalId } });
    if (!config) return res.json([]);

    const { estado } = req.query;
    const where: any = { config_id: config.id };
    if (estado === 'activa' || estado === 'completada' || estado === 'canjeada') where.estado = String(estado);

    const cartillas = await prisma.cartilla_cliente.findMany({
      where,
      include: { usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true, telefono: true } } },
      orderBy: { fecha_creacion: 'desc' },
      take: 200,
    });
    res.json(cartillas.map((c) => ({
      id: c.id,
      sellos: c.sellos,
      meta: config.sellos_requeridos,
      estado: c.estado,
      premio: config.premio,
      fecha_creacion: c.fecha_creacion,
      fecha_completada: c.fecha_completada,
      cliente: c.usuarios,
    })));
  } catch (error) {
    console.error('Error listando cartillas:', error);
    res.status(500).json({ error: 'Error al listar cartillas' });
  }
};

// PATCH /api/cartillas/:id/entregar  (empleado: marcar premio como entregado -> canjeada)
export const entregarPremio = async (req: Request, res: Response) => {
  try {
    const cartillaId = Number(req.params.id);
    const cartilla = await prisma.cartilla_cliente.findUnique({
      where: { id: cartillaId },
      include: { cartilla_config: { include: { sucursales: { select: { id: true, nombre: true } } } } },
    });
    if (!cartilla) return res.status(404).json({ error: 'Cartilla no encontrada' });
    if (cartilla.estado !== 'completada') return res.status(400).json({ error: 'Solo se puede entregar el premio de una cartilla completada' });

    const sucursalId = cartilla.cartilla_config.sucursales.id;
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });

    const actualizada = await prisma.cartilla_cliente.update({
      where: { id: cartillaId },
      data: { estado: 'canjeada' },
    });

    const titulo = `Premio entregado en ${cartilla.cartilla_config.sucursales.nombre}`;
    await prisma.notificaciones.create({
      data: {
        usuario_id: cartilla.usuario_id,
        tipo: 'cartilla',
        titulo,
        mensaje: `Disfruta tu premio: ${cartilla.cartilla_config.premio}. ¡Gracias por tu fidelidad!`,
        enlace: '/mis-cartillas',
        leido: false,
      },
    });
    notificarUsuario(cartilla.usuario_id, { tipo: 'cartilla', titulo, enlace: '/mis-cartillas' });

    res.json({ id: actualizada.id, estado: actualizada.estado });
  } catch (error) {
    console.error('Error entregando premio:', error);
    res.status(500).json({ error: 'Error al entregar premio' });
  }
};
