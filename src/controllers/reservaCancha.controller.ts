import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { verificarAccesoSucursal } from '../services/acceso.service.js';
import { notificarUsuario, enviarWhatsApp } from '../services/socket.service.js';

const timeToDate = (hora?: string): Date | null => {
  if (!hora) return null;
  const limpia = hora.includes(':') ? hora : `${hora}:00`;
  return new Date(`1970-01-01T${limpia}`);
};

const horaStr = (d?: Date | null): string | null => {
  if (!d) return null;
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
};

const serializar = (r: any) => ({
  ...r,
  hora_inicio: horaStr(r.hora_inicio),
  hora_fin: horaStr(r.hora_fin)
});

export const disponibilidad = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'fecha es requerida (YYYY-MM-DD)' });

    const fechaDate = new Date(String(fecha));
    if (isNaN(fechaDate.getTime())) return res.status(400).json({ error: 'fecha inválida' });

    const canchas = await prisma.canchas.findMany({
      where: { sucursal_id: sucursalId, activa: true },
      orderBy: { id: 'asc' }
    });

    const reservadas = await prisma.reservas_cancha.findMany({
      where: {
        cancha_id: { in: canchas.map((c) => c.id) },
        fecha_reserva: fechaDate,
        estado: { in: ['pendiente', 'confirmada'] }
      },
      select: { cancha_id: true, hora_inicio: true, hora_fin: true }
    });

    const agenda = canchas.map((c) => {
      const ocupadas = reservadas.filter((r) => r.cancha_id === c.id);
      return {
        cancha: { id: c.id, nombre: c.nombre, capacidad: c.capacidad, precio_hora: c.precio_hora, tipo: c.tipo },
        ocupadas: ocupadas.map((o) => ({ hora_inicio: horaStr(o.hora_inicio), hora_fin: horaStr(o.hora_fin) }))
      };
    });

    res.json(agenda);
  } catch (error) {
    console.error('Error consultando disponibilidad de canchas:', error);
    res.status(500).json({ error: 'Error al consultar disponibilidad' });
  }
};

export const reservar = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const { cancha_id, fecha, hora_inicio, duracion_horas, cantidad_jugadores, observaciones, cliente_nombre, cliente_telefono, cliente_correo } = req.body;

    if (!cancha_id || !fecha || !hora_inicio) {
      return res.status(400).json({ error: 'cancha_id, fecha y hora_inicio son requeridos' });
    }

    const cancha = await prisma.canchas.findFirst({
      where: { id: Number(cancha_id), sucursal_id: sucursalId, activa: true }
    });
    if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada o inactiva' });

    const fechaDate = new Date(fecha);
    if (isNaN(fechaDate.getTime())) return res.status(400).json({ error: 'fecha inválida' });

    const horaInicio = timeToDate(hora_inicio);
    if (!horaInicio) return res.status(400).json({ error: 'hora_inicio inválida' });

    const duracion = Number(duracion_horas) || 1;
    const horaFin = new Date(horaInicio.getTime() + duracion * 60 * 60 * 1000);

    const conflicto = await prisma.reservas_cancha.findFirst({
      where: {
        cancha_id: Number(cancha_id),
        fecha_reserva: fechaDate,
        estado: { in: ['pendiente', 'confirmada'] },
        AND: [
          { hora_inicio: { lt: horaFin } },
          { hora_fin: { gt: horaInicio } }
        ]
      }
    });
    if (conflicto) {
      return res.status(409).json({ error: 'La cancha no está disponible en ese horario' });
    }

    const usuario = await prisma.usuarios.findUnique({
      where: { id: req.user.id },
      select: { nombres: true, apellidos: true, telefono: true, correo: true }
    });

    const reserva = await prisma.reservas_cancha.create({
      data: {
        cancha_id: Number(cancha_id),
        sucursal_id: sucursalId,
        usuario_id: req.user.id,
        fecha_reserva: fechaDate,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        duracion_horas: duracion,
        cantidad_jugadores: cantidad_jugadores ? Number(cantidad_jugadores) : null,
        observaciones: observaciones || null,
        cliente_nombre: cliente_nombre || `${usuario?.nombres || ''} ${usuario?.apellidos || ''}`.trim() || null,
        cliente_telefono: cliente_telefono || usuario?.telefono || null,
        cliente_correo: cliente_correo || usuario?.correo || null,
        estado: 'pendiente'
      },
      include: { canchas: true, sucursales: { include: { empresas: true } } }
    });

    const sucursal = await prisma.sucursales.findUnique({
      where: { id: sucursalId },
      select: { empresa_id: true, nombre: true }
    });
    if (sucursal) {
      const duenos = await prisma.usuario_empresas.findMany({
        where: { empresa_id: sucursal.empresa_id },
        select: { usuario_id: true }
      });
      for (const d of duenos) {
        await prisma.notificaciones.create({
          data: {
            usuario_id: d.usuario_id,
            titulo: 'Nueva reserva de cancha',
            mensaje: `Se ha realizado una reserva en ${sucursal.nombre} para el ${fechaDate.toLocaleDateString()} a las ${hora_inicio}`
          }
        });
        notificarUsuario(d.usuario_id, {
          tipo: 'nueva_reserva_cancha',
          reserva_id: reserva.id,
          sucursal: sucursal.nombre,
          fecha: fecha,
          hora: hora_inicio
        });
      }
    }

    if (reserva.cliente_telefono) {
      const msg = `Tu reserva de cancha en ${reserva.sucursales?.nombre || ''} ha sido creada. Fecha: ${fecha}, Hora: ${hora_inicio}. Estado: Pendiente.`;
      enviarWhatsApp(reserva.cliente_telefono, msg);
    }

    res.status(201).json(serializar(reserva));
  } catch (error) {
    console.error('Error creando reserva de cancha:', error);
    res.status(500).json({ error: 'Error al crear reserva de cancha' });
  }
};

export const crearManualReservaCancha = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({
      where: { id: sucursalId },
      select: { id: true, empresa_id: true }
    });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    const { cancha_id, fecha, hora_inicio, duracion_horas, cantidad_jugadores, observaciones, cliente_nombre, cliente_telefono, cliente_correo } = req.body;
    if (!cancha_id || !fecha || !hora_inicio) {
      return res.status(400).json({ error: 'cancha_id, fecha y hora_inicio son requeridos' });
    }

    const cancha = await prisma.canchas.findFirst({
      where: { id: Number(cancha_id), sucursal_id: sucursalId, activa: true }
    });
    if (!cancha) return res.status(404).json({ error: 'Cancha no encontrada o inactiva' });

    const fechaDate = new Date(fecha);
    if (isNaN(fechaDate.getTime())) return res.status(400).json({ error: 'fecha inválida' });

    const horaInicio = timeToDate(hora_inicio);
    if (!horaInicio) return res.status(400).json({ error: 'hora_inicio inválida' });

    const duracion = Number(duracion_horas) || 1;
    const horaFin = new Date(horaInicio.getTime() + duracion * 60 * 60 * 1000);

    const conflicto = await prisma.reservas_cancha.findFirst({
      where: {
        cancha_id: Number(cancha_id),
        fecha_reserva: fechaDate,
        estado: { in: ['pendiente', 'confirmada'] },
        AND: [
          { hora_inicio: { lt: horaFin } },
          { hora_fin: { gt: horaInicio } }
        ]
      }
    });
    if (conflicto) {
      return res.status(409).json({ error: 'La cancha no está disponible en ese horario' });
    }

    const reserva = await prisma.reservas_cancha.create({
      data: {
        cancha_id: Number(cancha_id),
        sucursal_id: sucursalId,
        usuario_id: null,
        fecha_reserva: fechaDate,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        duracion_horas: duracion,
        cantidad_jugadores: cantidad_jugadores ? Number(cantidad_jugadores) : null,
        observaciones: observaciones || null,
        cliente_nombre: cliente_nombre || null,
        cliente_telefono: cliente_telefono || null,
        cliente_correo: cliente_correo || null,
        estado: 'pendiente'
      },
      include: { canchas: true, sucursales: { include: { empresas: true } } }
    });

    res.status(201).json(serializar(reserva));
  } catch (error) {
    console.error('Error creando reserva manual de cancha:', error);
    res.status(500).json({ error: 'Error al crear reserva de cancha' });
  }
};

export const listarSucursal = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({
      where: { id: sucursalId },
      select: { id: true, empresa_id: true }
    });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    const reservas = await prisma.reservas_cancha.findMany({
      where: { sucursal_id: sucursalId },
      orderBy: { fecha_reserva: 'desc' },
      include: {
        canchas: { select: { id: true, nombre: true } },
        usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true, telefono: true } }
      }
    });
    res.json(reservas.map(serializar));
  } catch (error) {
    console.error('Error listando reservas de cancha:', error);
    res.status(500).json({ error: 'Error al listar reservas de cancha' });
  }
};

export const misReservas = async (req: Request, res: Response) => {
  try {
    const reservas = await prisma.reservas_cancha.findMany({
      where: { usuario_id: req.user.id },
      orderBy: { fecha_reserva: 'desc' },
      include: {
        canchas: { select: { id: true, nombre: true, tipo: true } },
        sucursales: { include: { ciudades: { select: { nombre: true } }, empresas: { select: { id: true, nombre: true } } } }
      }
    });
    res.json(reservas.map(serializar));
  } catch (error) {
    console.error('Error listando mis reservas de cancha:', error);
    res.status(500).json({ error: 'Error al listar mis reservas de cancha' });
  }
};

export const editar = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const reservaId = Number(req.params.reservaId);
    const sucursal = await prisma.sucursales.findUnique({
      where: { id: sucursalId },
      select: { id: true, empresa_id: true }
    });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    const existente = await prisma.reservas_cancha.findFirst({
      where: { id: reservaId, sucursal_id: sucursalId }
    });
    if (!existente) return res.status(404).json({ error: 'Reserva no encontrada' });

    const { cantidad_jugadores, observaciones, cliente_nombre, cliente_telefono, cliente_correo } = req.body;
    const data: any = {};
    if (cantidad_jugadores !== undefined) data.cantidad_jugadores = Number(cantidad_jugadores);
    if (observaciones !== undefined) data.observaciones = observaciones || null;
    if (cliente_nombre !== undefined) data.cliente_nombre = cliente_nombre || null;
    if (cliente_telefono !== undefined) data.cliente_telefono = cliente_telefono || null;
    if (cliente_correo !== undefined) data.cliente_correo = cliente_correo || null;

    const reserva = await prisma.reservas_cancha.update({
      where: { id: reservaId },
      data,
      include: { canchas: true, sucursales: { include: { empresas: true } } }
    });
    res.json(serializar(reserva));
  } catch (error) {
    console.error('Error editando reserva de cancha:', error);
    res.status(500).json({ error: 'Error al editar reserva de cancha' });
  }
};

export const cancelar = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const reservaId = Number(req.params.reservaId);
    const sucursal = await prisma.sucursales.findUnique({
      where: { id: sucursalId },
      select: { id: true, empresa_id: true }
    });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    const existente = await prisma.reservas_cancha.findFirst({
      where: { id: reservaId, sucursal_id: sucursalId }
    });
    if (!existente) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (existente.estado === 'cancelada') return res.status(400).json({ error: 'La reserva ya está cancelada' });
    if (existente.estado === 'completada') return res.status(400).json({ error: 'No se puede cancelar una reserva completada' });

    const reserva = await prisma.reservas_cancha.update({
      where: { id: reservaId },
      data: { estado: 'cancelada' },
      include: { canchas: true, sucursales: { include: { empresas: true } } }
    });

    if (reserva.usuario_id) {
      await prisma.notificaciones.create({
        data: {
          usuario_id: reserva.usuario_id,
          titulo: 'Reserva de cancha cancelada',
          mensaje: `Tu reserva en ${reserva.sucursales?.nombre || ''} para el ${reserva.fecha_reserva?.toLocaleDateString()} ha sido cancelada`
        }
      });
      notificarUsuario(reserva.usuario_id, {
        tipo: 'reserva_cancha_estado',
        reserva_id: reserva.id,
        estado: 'cancelada',
        sucursal: reserva.sucursales?.nombre
      });
    }

    res.json(serializar(reserva));
  } catch (error) {
    console.error('Error cancelando reserva de cancha:', error);
    res.status(500).json({ error: 'Error al cancelar reserva de cancha' });
  }
};

const estadosValidos = ['pendiente', 'confirmada', 'cancelada', 'completada'];

export const actualizarEstado = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const reservaId = Number(req.params.reservaId);
    const sucursal = await prisma.sucursales.findUnique({
      where: { id: sucursalId },
      select: { id: true, empresa_id: true }
    });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await verificarAccesoSucursal(req.user.id, sucursalId))) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    const { estado } = req.body;
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: `estado inválido. Valores: ${estadosValidos.join(', ')}` });
    }

    const existente = await prisma.reservas_cancha.findFirst({
      where: { id: reservaId, sucursal_id: sucursalId }
    });
    if (!existente) return res.status(404).json({ error: 'Reserva no encontrada' });

    const reserva = await prisma.reservas_cancha.update({
      where: { id: reservaId },
      data: { estado },
      include: { canchas: true, sucursales: { include: { empresas: true } } }
    });

    if (reserva.usuario_id) {
      await prisma.notificaciones.create({
        data: {
          usuario_id: reserva.usuario_id,
          titulo: 'Estado de reserva de cancha actualizado',
          mensaje: `Tu reserva en ${reserva.sucursales?.nombre || ''} ahora está en estado: ${estado}`
        }
      });
      notificarUsuario(reserva.usuario_id, {
        tipo: 'reserva_cancha_estado',
        reserva_id: reserva.id,
        estado,
        sucursal: reserva.sucursales?.nombre
      });
    }

    res.json(serializar(reserva));
  } catch (error) {
    console.error('Error actualizando estado de reserva de cancha:', error);
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
};

export const obtenerPorId = async (req: Request, res: Response) => {
  try {
    const reservaId = Number(req.params.reservaId);
    const reserva = await prisma.reservas_cancha.findUnique({
      where: { id: reservaId },
      include: {
        canchas: true,
        sucursales: { include: { ciudades: { select: { nombre: true } }, empresas: { select: { id: true, nombre: true } } } },
        usuarios: { select: { id: true, nombres: true, apellidos: true, correo: true, telefono: true } }
      }
    });
    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });
    res.json(serializar(reserva));
  } catch (error) {
    console.error('Error obteniendo reserva de cancha:', error);
    res.status(500).json({ error: 'Error al obtener reserva de cancha' });
  }
};
