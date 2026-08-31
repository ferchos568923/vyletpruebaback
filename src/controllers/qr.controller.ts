import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { generarQRToken, verificarQRToken, generarQRReserva as genQRReserva, verificarQRReserva as verQRReserva, TipoReserva } from '../services/qr.service.js';

// Verificar que el usuario (dueño o empleado) tiene acceso a la sucursal
const verificarAccesoSucursal = async (userId: number, sucursalId: number): Promise<boolean> => {
  const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId }, select: { empresa_id: true } });
  if (!sucursal) return false;

  // Dueño de la empresa (usuario_empresas)
  const dueno = await prisma.usuario_empresas.findFirst({
    where: { usuario_id: userId, empresa_id: sucursal.empresa_id }
  });
  if (dueno) return true;

  // Propietario directo de la empresa
  const empresa = await prisma.empresas.findUnique({ where: { id: sucursal.empresa_id }, select: { propietario: true } });
  if (empresa?.propietario) {
    const usuario = await prisma.usuarios.findUnique({ where: { id: userId }, select: { correo: true } });
    if (usuario?.correo === empresa.propietario) return true;
  }

  // Empleado asignado a la sucursal
  const empleado = await prisma.empresa_empleados.findFirst({
    where: { usuario_id: userId, empresa_id: sucursal.empresa_id, activo: true },
    include: { empleado_sucursales: { where: { sucursal_id: sucursalId } } }
  });
  if (empleado && empleado.empleado_sucursales.length > 0) return true;

  return false;
};

// POST /api/cupones/:id/generar-qr  (cliente autenticado)
export const generarQR = async (req: Request, res: Response) => {
  try {
    const cuponId = Number(req.params.id);
    const usuarioId = req.user.id;

    // Verificar que el cupón existe y está activo
    const cupon = await prisma.cupones.findUnique({
      where: { id: cuponId },
      include: { sucursales: { select: { nombre: true, activo: true } } }
    });
    if (!cupon) return res.status(404).json({ error: 'Cupón no encontrado' });
    if (!cupon.activo) return res.status(400).json({ error: 'Cupón inactivo' });

    // Verificar fechas
    const hoy = new Date();
    if (cupon.fecha_inicio && cupon.fecha_inicio > hoy) {
      return res.status(400).json({ error: 'Cupón aún no está disponible' });
    }
    if (cupon.fecha_fin && cupon.fecha_fin < hoy) {
      return res.status(400).json({ error: 'Cupón expirado' });
    }

    // Verificar usos disponibles
    if (cupon.cantidad_usos && (cupon.usos_realizados ?? 0) >= cupon.cantidad_usos) {
      return res.status(400).json({ error: 'Cupón agotado' });
    }

    // Verificar que el usuario no haya canjeado ya este cupón (estado = canjeado)
    const yaCanjeado = await prisma.cupones_usuario.findFirst({
      where: { cupon_id: cuponId, usuario_id: usuarioId, estado: 'canjeado' }
    });
    if (yaCanjeado) {
      return res.status(400).json({ error: 'Ya canjeaste este cupón' });
    }

    // Verificar que no tenga un QR pendiente activo para este cupón
    const pendiente = await prisma.cupones_usuario.findFirst({
      where: { cupon_id: cuponId, usuario_id: usuarioId, estado: 'pendiente' }
    });

    // Generar token QR
    const token = generarQRToken(usuarioId, cuponId);

    // Si ya tiene pendiente, actualizar el token; si no, crear registro
    if (pendiente) {
      // El registro ya existe, solo devolvemos el QR
      // (el token se valida en tiempo de escaneo, no se almacena)
    } else {
      await prisma.cupones_usuario.create({
        data: { cupon_id: cuponId, usuario_id: usuarioId, estado: 'pendiente' }
      });
    }

    res.json({
      token,
      qr_data: `VYLET-QR:${token}`,
      cupon: {
        titulo: cupon.titulo,
        tipo_descuento: cupon.tipo_descuento,
        valor_descuento: cupon.valor_descuento,
        sucursal: cupon.sucursales.nombre,
      },
      expira_en: '5 minutos',
    });
  } catch (error) {
    console.error('Error generando QR:', error);
    res.status(500).json({ error: 'Error al generar QR' });
  }
};

// POST /api/cupones/verificar-qr  (empleado autenticado)
export const verificarQR = async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    // Decodificar token
    const payload = verificarQRToken(token);
    if (!payload) {
      return res.status(400).json({ error: 'QR inválido o expirado', codigo: 'QR_EXPIRADO' });
    }

    const { uid, cid } = payload;

    // Buscar el registro de cupón_usuario
    const cuponUsuario = await prisma.cupones_usuario.findFirst({
      where: { cupon_id: cid, usuario_id: uid },
      include: {
        cupones: {
          include: { sucursales: { select: { id: true, nombre: true } } }
        },
        usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true, cedula: true } }
      }
    });

    if (!cuponUsuario) {
      return res.status(404).json({ error: 'Canje no encontrado' });
    }

    if (cuponUsuario.estado === 'canjeado') {
      return res.status(400).json({ error: 'Este cupón ya fue canjeado', codigo: 'YA_CANJEADO' });
    }

    // Verificar que el cupón sigue activo
    const cupon = cuponUsuario.cupones;
    if (!cupon.activo) {
      return res.status(400).json({ error: 'Cupón inactivo' });
    }

    const hoy = new Date();
    if (cupon.fecha_fin && cupon.fecha_fin < hoy) {
      return res.status(400).json({ error: 'Cupón expirado' });
    }

    if (cupon.cantidad_usos && (cupon.usos_realizados ?? 0) >= cupon.cantidad_usos) {
      return res.status(400).json({ error: 'Cupón agotado' });
    }

    // Verificar que el empleado tiene acceso a esta sucursal
    if (!await verificarAccesoSucursal(req.user.id, cupon.sucursales.id)) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    // Devolver datos para que el empleado confirme
    res.json({
      valido: true,
      cliente: {
        nombre: `${cuponUsuario.usuarios.nombres} ${cuponUsuario.usuarios.apellidos || ''}`.trim(),
        correo: cuponUsuario.usuarios.correo,
        cedula: cuponUsuario.usuarios.cedula,
      },
      cupon: {
        id: cupon.id,
        titulo: cupon.titulo,
        tipo_descuento: cupon.tipo_descuento,
        valor_descuento: cupon.valor_descuento,
        sucursal: cupon.sucursales.nombre,
        sucursal_id: cupon.sucursales.id,
      },
      canje_id: cuponUsuario.id,
    });
  } catch (error) {
    console.error('Error verificando QR:', error);
    res.status(500).json({ error: 'Error al verificar QR' });
  }
};

// POST /api/cupones/confirmar-canje  (empleado autenticado)
export const confirmarCanje = async (req: Request, res: Response) => {
  try {
    const { canje_id } = req.body;
    if (!canje_id) return res.status(400).json({ error: 'canje_id requerido' });

    const cuponUsuario = await prisma.cupones_usuario.findUnique({
      where: { id: canje_id },
      include: { cupones: { include: { sucursales: { select: { id: true } } } } }
    });

    if (!cuponUsuario) return res.status(404).json({ error: 'Canje no encontrado' });
    if (cuponUsuario.estado === 'canjeado') {
      return res.status(400).json({ error: 'Ya fue canjeado' });
    }

    // Verificar acceso a la sucursal
    if (!await verificarAccesoSucursal(req.user.id, cuponUsuario.cupones.sucursales.id)) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    // Ejecutar canje atómico
    await prisma.$transaction([
      prisma.cupones_usuario.update({
        where: { id: canje_id },
        data: { estado: 'canjeado', fecha_canje: new Date() }
      }),
      prisma.cupones.update({
        where: { id: cuponUsuario.cupon_id },
        data: { usos_realizados: { increment: 1 } }
      })
    ]);

    res.json({ message: 'Canje confirmado correctamente' });
  } catch (error) {
    console.error('Error confirmando canje:', error);
    res.status(500).json({ error: 'Error al confirmar canje' });
  }
};

// ============================================================
// QR PARA RESERVAS (mesa, habitación, visita)
// ============================================================

// POST /api/reservas/:id/generar-qr  (cliente autenticado)
export const generarQRReservaCtrl = async (req: Request, res: Response) => {
  try {
    const reservaId = Number(req.params.id);
    const tipo = req.query.tipo as TipoReserva;
    const usuarioId = req.user.id;

    if (!tipo || !['mesa', 'habitacion', 'visita'].includes(tipo)) {
      return res.status(400).json({ error: 'Tipo de reserva inválido (mesa | habitacion | visita)' });
    }

    let reserva: any = null;
    let sucursalNombre = '';

    if (tipo === 'mesa') {
      reserva = await prisma.reservas.findUnique({
        where: { id: reservaId },
        include: { sucursales: { select: { nombre: true } }, mesas: { select: { nombre: true } } }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      if (reserva.usuario_id !== usuarioId) return res.status(403).json({ error: 'No autorizado' });
      if (reserva.estado === 'cancelada') return res.status(400).json({ error: 'Reserva cancelada' });
      if (reserva.estado === 'completada') return res.status(400).json({ error: 'Reserva ya completada' });
      sucursalNombre = reserva.sucursales?.nombre ?? '';
    } else if (tipo === 'habitacion') {
      reserva = await prisma.reservas_habitacion.findUnique({
        where: { id: reservaId },
        include: { habitaciones: { select: { nombre: true, sucursales: { select: { nombre: true } } } } }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      if (reserva.usuario_id !== usuarioId) return res.status(403).json({ error: 'No autorizado' });
      if (reserva.estado === 'cancelada') return res.status(400).json({ error: 'Reserva cancelada' });
      if (reserva.estado === 'completada') return res.status(400).json({ error: 'Reserva ya completada' });
      sucursalNombre = reserva.habitaciones?.sucursales?.nombre ?? '';
    } else if (tipo === 'visita') {
      reserva = await prisma.reservas_visita.findUnique({
        where: { id: reservaId },
        include: { sucursales: { select: { nombre: true } } }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      if (reserva.usuario_id !== usuarioId) return res.status(403).json({ error: 'No autorizado' });
      if (reserva.estado === 'cancelada') return res.status(400).json({ error: 'Reserva cancelada' });
      if (reserva.estado === 'completada') return res.status(400).json({ error: 'Reserva ya completada' });
      sucursalNombre = reserva.sucursales?.nombre ?? '';
    }

    const token = genQRReserva(usuarioId, reservaId, tipo);

    res.json({
      token,
      qr_data: `VYLET-QR:${token}`,
      reserva: { id: reservaId, tipo, sucursal: sucursalNombre },
      expira_en: '5 minutos',
    });
  } catch (error) {
    console.error('Error generando QR reserva:', error);
    res.status(500).json({ error: 'Error al generar QR' });
  }
};

// POST /api/reservas/verificar-qr  (empleado autenticado)
export const verificarQRReservaCtrl = async (req: Request, res: Response) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const payload = verQRReserva(token);
    if (!payload) {
      return res.status(400).json({ error: 'QR inválido o expirado', codigo: 'QR_EXPIRADO' });
    }

    const { uid, rid, rtipo } = payload;
    let reserva: any = null;
    let sucursalId = 0;

    if (rtipo === 'mesa') {
      reserva = await prisma.reservas.findUnique({
        where: { id: rid },
        include: {
          sucursales: { select: { id: true, nombre: true } },
          mesas: { select: { nombre: true, puestos: true } },
          usuarios: { select: { nombres: true, apellidos: true, correo: true, cedula: true } }
        }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      sucursalId = reserva.sucursal_id;
    } else if (rtipo === 'habitacion') {
      reserva = await prisma.reservas_habitacion.findUnique({
        where: { id: rid },
        include: {
          habitaciones: { select: { nombre: true, sucursal_id: true, sucursales: { select: { id: true, nombre: true } } } },
          usuarios: { select: { nombres: true, apellidos: true, correo: true, cedula: true } }
        }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      sucursalId = reserva.habitaciones?.sucursal_id ?? 0;
    } else if (rtipo === 'visita') {
      reserva = await prisma.reservas_visita.findUnique({
        where: { id: rid },
        include: {
          sucursales: { select: { id: true, nombre: true } },
          usuarios: { select: { nombres: true, apellidos: true, correo: true, cedula: true } }
        }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      sucursalId = reserva.sucursal_id;
    }

    // Verificar acceso a la sucursal
    if (sucursalId && !await verificarAccesoSucursal(req.user.id, sucursalId)) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    if (reserva.estado === 'cancelada') {
      return res.status(400).json({ error: 'Reserva cancelada', codigo: 'CANCELADA' });
    }
    if (reserva.estado === 'completada') {
      return res.status(400).json({ error: 'Reserva ya fue atendida', codigo: 'COMPLETADA' });
    }

    // Construir respuesta según tipo
    const cliente = reserva.usuarios
      ? { nombre: `${reserva.usuarios.nombres} ${reserva.usuarios.apellidos || ''}`.trim(), correo: reserva.usuarios.correo, cedula: reserva.usuarios.cedula }
      : { nombre: reserva.cliente_nombre || 'Cliente', correo: null, cedula: null };

    let detalle: any = { id: rid, tipo: rtipo, sucursal_id: sucursalId };

    if (rtipo === 'mesa') {
      detalle = {
        ...detalle,
        sucursal: reserva.sucursales?.nombre,
        mesa: reserva.mesas?.nombre ?? 'Sin nombre',
        personas: reserva.cantidad_personas,
        fecha: reserva.fecha_reserva,
        hora: reserva.hora_inicio,
        estado: reserva.estado,
      };
    } else if (rtipo === 'habitacion') {
      detalle = {
        ...detalle,
        sucursal: reserva.habitaciones?.sucursales?.nombre,
        habitacion: reserva.habitaciones?.nombre ?? 'Sin nombre',
        fecha_entrada: reserva.fecha_entrada,
        fecha_salida: reserva.fecha_salida,
        personas: reserva.personas,
        estado: reserva.estado,
      };
    } else if (rtipo === 'visita') {
      detalle = {
        ...detalle,
        sucursal: reserva.sucursales?.nombre,
        fecha: reserva.fecha_visita,
        hora: reserva.hora_visita,
        adultos: reserva.cantidad_adultos,
        ninos: reserva.cantidad_ninos,
        estado: reserva.estado,
      };
    }

    res.json({ valido: true, cliente, reserva: detalle, reserva_id: rid });
  } catch (error) {
    console.error('Error verificando QR reserva:', error);
    res.status(500).json({ error: 'Error al verificar QR' });
  }
};

// POST /api/reservas/confirmar-llegada  (empleado autenticado)
export const confirmarLlegada = async (req: Request, res: Response) => {
  try {
    const { reserva_id, tipo } = req.body;
    if (!reserva_id || !tipo) return res.status(400).json({ error: 'reserva_id y tipo requeridos' });

    let reserva: any = null;
    let cliente: any = null;
    let detalle: any = null;

    if (tipo === 'mesa') {
      reserva = await prisma.reservas.findUnique({
        where: { id: reserva_id },
        include: {
          sucursales: { select: { id: true, nombre: true } },
          mesas: { select: { nombre: true, puestos: true } },
          usuarios: { select: { nombres: true, apellidos: true, correo: true, cedula: true, telefono: true } }
        }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      if (!await verificarAccesoSucursal(req.user.id, reserva.sucursal_id)) {
        return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
      }
      if (reserva.estado !== 'pendiente' && reserva.estado !== 'confirmada') {
        return res.status(400).json({ error: `Reserva en estado "${reserva.estado}"` });
      }
      await prisma.reservas.update({ where: { id: reserva_id }, data: { estado: 'completada' } });
      cliente = reserva.usuarios
        ? { nombre: `${reserva.usuarios.nombres} ${reserva.usuarios.apellidos || ''}`.trim(), correo: reserva.usuarios.correo, cedula: reserva.usuarios.cedula, telefono: reserva.usuarios.telefono }
        : { nombre: reserva.cliente_nombre || 'Cliente', correo: reserva.cliente_correo, cedula: null, telefono: reserva.cliente_telefono };
      detalle = {
        tipo: 'mesa',
        sucursal: reserva.sucursales?.nombre,
        sucursal_id: reserva.sucursales?.id,
        mesa: reserva.mesas?.nombre ?? 'Sin nombre',
        personas: reserva.cantidad_personas,
        fecha: reserva.fecha_reserva,
        hora: reserva.hora_inicio,
        observaciones: reserva.observaciones,
        estado: 'completada',
      };
    } else if (tipo === 'habitacion') {
      reserva = await prisma.reservas_habitacion.findUnique({
        where: { id: reserva_id },
        include: {
          habitaciones: { select: { nombre: true, sucursal_id: true, precio: true, capacidad: true, sucursales: { select: { id: true, nombre: true } } } },
          usuarios: { select: { nombres: true, apellidos: true, correo: true, cedula: true, telefono: true } }
        }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      if (!await verificarAccesoSucursal(req.user.id, reserva.habitaciones?.sucursal_id ?? 0)) {
        return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
      }
      if (reserva.estado !== 'pendiente' && reserva.estado !== 'confirmada') {
        return res.status(400).json({ error: `Reserva en estado "${reserva.estado}"` });
      }
      await prisma.reservas_habitacion.update({ where: { id: reserva_id }, data: { estado: 'completada' } });
      cliente = reserva.usuarios
        ? { nombre: `${reserva.usuarios.nombres} ${reserva.usuarios.apellidos || ''}`.trim(), correo: reserva.usuarios.correo, cedula: reserva.usuarios.cedula, telefono: reserva.usuarios.telefono }
        : { nombre: reserva.cliente_nombre || 'Cliente', correo: reserva.cliente_correo, cedula: null, telefono: reserva.cliente_telefono };
      detalle = {
        tipo: 'habitacion',
        sucursal: reserva.habitaciones?.sucursales?.nombre,
        sucursal_id: reserva.habitaciones?.sucursales?.id,
        habitacion: reserva.habitaciones?.nombre ?? 'Sin nombre',
        precio: reserva.habitaciones?.precio,
        capacidad: reserva.habitaciones?.capacidad,
        fecha_entrada: reserva.fecha_entrada,
        fecha_salida: reserva.fecha_salida,
        personas: reserva.personas,
        observaciones: reserva.observaciones,
        estado: 'completada',
      };
    } else if (tipo === 'visita') {
      reserva = await prisma.reservas_visita.findUnique({
        where: { id: reserva_id },
        include: {
          sucursales: { select: { id: true, nombre: true } },
          usuarios: { select: { nombres: true, apellidos: true, correo: true, cedula: true, telefono: true } }
        }
      });
      if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
      if (!await verificarAccesoSucursal(req.user.id, reserva.sucursal_id)) {
        return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
      }
      if (reserva.estado !== 'pendiente' && reserva.estado !== 'confirmada') {
        return res.status(400).json({ error: `Reserva en estado "${reserva.estado}"` });
      }
      await prisma.reservas_visita.update({ where: { id: reserva_id }, data: { estado: 'completada' } });
      cliente = reserva.usuarios
        ? { nombre: `${reserva.usuarios.nombres} ${reserva.usuarios.apellidos || ''}`.trim(), correo: reserva.usuarios.correo, cedula: reserva.usuarios.cedula, telefono: reserva.usuarios.telefono }
        : { nombre: reserva.cliente_nombre || 'Cliente', correo: null, cedula: null, telefono: reserva.cliente_telefono };
      detalle = {
        tipo: 'visita',
        sucursal: reserva.sucursales?.nombre,
        sucursal_id: reserva.sucursales?.id,
        fecha: reserva.fecha_visita,
        hora: reserva.hora_visita,
        adultos: reserva.cantidad_adultos,
        ninos: reserva.cantidad_ninos,
        observaciones: reserva.observaciones,
        estado: 'completada',
      };
    } else {
      return res.status(400).json({ error: 'Tipo inválido' });
    }

    res.json({ message: 'Llegada confirmada. Reserva completada.', cliente, reserva: detalle });
  } catch (error) {
    console.error('Error confirmando llegada:', error);
    res.status(500).json({ error: 'Error al confirmar llegada' });
  }
};
