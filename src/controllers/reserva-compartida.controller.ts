import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';

// GET /api/usuarios/buscar?q=
export const buscarUsuarios = async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 3) {
      return res.status(400).json({ error: 'Escribe al menos 3 caracteres (cédula o nombre)' });
    }
    const esNumerico = /^\d+$/.test(q);
    const usuarios = await prisma.usuarios.findMany({
      where: {
        activo: true,
        id: { not: req.user.id },
        OR: [
          ...(esNumerico ? [{ cedula: { contains: q } }] : []),
          { nombres: { contains: q, mode: 'insensitive' } },
          { apellidos: { contains: q, mode: 'insensitive' } }
        ]
      },
      select: { id: true, nombres: true, apellidos: true, cedula: true, foto: true },
      orderBy: { nombres: 'asc' },
      take: 10
    });
    res.json(usuarios);
  } catch (error) {
    console.error('Error buscando usuarios:', error);
    res.status(500).json({ error: 'Error al buscar usuarios' });
  }
};

// POST /api/reservas/:id/compartir  { usuario_id, tipo_reserva }
export const compartirReserva = async (req: Request, res: Response) => {
  try {
    const reservaId = Number(req.params.id);
    const usuarioId = Number(req.body?.usuario_id);
    const tipoReserva = String(req.body?.tipo_reserva ?? 'mesa');

    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return res.status(400).json({ error: 'usuario_id es requerido' });
    }
    if (!['mesa', 'habitacion', 'visita'].includes(tipoReserva)) {
      return res.status(400).json({ error: 'tipo_reserva debe ser: mesa, habitacion o visita' });
    }

    // Verificar que el usuario destino existe
    const destino = await prisma.usuarios.findFirst({ where: { id: usuarioId, activo: true } });
    if (!destino) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (destino.id === req.user.id) {
      return res.status(400).json({ error: 'No puedes compartir contigo mismo' });
    }

    // Verificar que la reserva existe y pertenece al usuario
    let reserva: any = null;
    let nombreLugar = '';

    if (tipoReserva === 'mesa') {
      reserva = await prisma.reservas.findFirst({
        where: { id: reservaId, usuario_id: req.user.id },
        include: { sucursales: { select: { nombre: true } } }
      });
      if (reserva) nombreLugar = reserva.sucursales?.nombre ?? '';
    } else if (tipoReserva === 'habitacion') {
      reserva = await prisma.reservas_habitacion.findFirst({
        where: { id: reservaId, usuario_id: req.user.id },
        include: { habitaciones: { include: { sucursales: { select: { nombre: true } } } } }
      });
      if (reserva) nombreLugar = reserva.habitaciones?.sucursales?.nombre ?? '';
    } else if (tipoReserva === 'visita') {
      reserva = await prisma.reservas_visita.findFirst({
        where: { id: reservaId, usuario_id: req.user.id },
        include: { sucursales: { select: { nombre: true } } }
      });
      if (reserva) nombreLugar = reserva.sucursales?.nombre ?? '';
    }

    if (!reserva) return res.status(404).json({ error: 'Reserva no encontrada' });

    // Verificar que no ya fue compartida
    const existe = await prisma.reservas_compartidas.findUnique({
      where: { reserva_id_compartido_con_usuario_id_tipo_reserva: { reserva_id: reservaId, compartido_con_usuario_id: usuarioId, tipo_reserva: tipoReserva } }
    });
    if (existe) return res.status(409).json({ error: 'Ya compartiste esta reserva con ese usuario' });

    // Crear compartida + notificación
    await prisma.$transaction([
      prisma.reservas_compartidas.create({
        data: {
          reserva_id: reservaId,
          tipo_reserva: tipoReserva,
          compartido_por_usuario_id: req.user.id,
          compartido_con_usuario_id: usuarioId,
        }
      }),
      prisma.notificaciones.create({
        data: {
          usuario_id: usuarioId,
          tipo: 'compartir',
          titulo: 'Te compartieron una reserva',
          mensaje: `${req.user.nombres} te compartió su reserva en "${nombreLugar}". Revísala en Mis Reservas.`,
          enlace: '/mis-reservas',
        }
      })
    ]);

    res.status(201).json({ message: 'Reserva compartida exitosamente' });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ error: 'Ya compartiste esta reserva con ese usuario' });
    }
    console.error('Error compartiendo reserva:', error);
    res.status(500).json({ error: 'Error al compartir reserva' });
  }
};

// GET /api/mis-reservas-compartidas
export const misReservasCompartidas = async (req: Request, res: Response) => {
  try {
    const compartidas = await prisma.reservas_compartidas.findMany({
      where: { compartido_con_usuario_id: req.user.id },
      include: {
        compartido_por: { select: { id: true, nombres: true, apellidos: true, foto: true } },
      },
      orderBy: { fecha_creacion: 'desc' }
    });

    // Enriquecer con datos de cada reserva según tipo
    const resultado = await Promise.all(
      compartidas.map(async (c) => {
        let reservaDetalle: any = null;

        if (c.tipo_reserva === 'mesa') {
          reservaDetalle = await prisma.reservas.findUnique({
            where: { id: c.reserva_id },
            include: {
              sucursales: { select: { id: true, nombre: true, ciudades: { select: { nombre: true } } } },
              mesas: { select: { nombre: true, puestos: true } },
            }
          });
        } else if (c.tipo_reserva === 'habitacion') {
          reservaDetalle = await prisma.reservas_habitacion.findUnique({
            where: { id: c.reserva_id },
            include: {
              habitaciones: {
                include: { sucursales: { select: { id: true, nombre: true, ciudades: { select: { nombre: true } } } } }
              }
            }
          });
        } else if (c.tipo_reserva === 'visita') {
          reservaDetalle = await prisma.reservas_visita.findUnique({
            where: { id: c.reserva_id },
            include: {
              sucursales: { select: { id: true, nombre: true, ciudades: { select: { nombre: true } } } },
            }
          });
        }

        return {
          id: c.id,
          reserva_id: c.reserva_id,
          tipo_reserva: c.tipo_reserva,
          estado: c.estado,
          fecha_creacion: c.fecha_creacion,
          compartido_por: c.compartido_por,
          reserva: reservaDetalle,
        };
      })
    );

    res.json(resultado);
  } catch (error) {
    console.error('Error obteniendo reservas compartidas:', error);
    res.status(500).json({ error: 'Error al obtener reservas compartidas' });
  }
};

// GET /api/mis-reservas-compartidas/enviadas
export const misReservasEnviadas = async (req: Request, res: Response) => {
  try {
    const compartidas = await prisma.reservas_compartidas.findMany({
      where: { compartido_por_usuario_id: req.user.id },
      include: {
        compartido_con: { select: { id: true, nombres: true, apellidos: true, foto: true } },
      },
      orderBy: { fecha_creacion: 'desc' }
    });

    const resultado = await Promise.all(
      compartidas.map(async (c) => {
        let reservaDetalle: any = null;

        if (c.tipo_reserva === 'mesa') {
          reservaDetalle = await prisma.reservas.findUnique({
            where: { id: c.reserva_id },
            include: {
              sucursales: { select: { id: true, nombre: true, ciudades: { select: { nombre: true } } } },
              mesas: { select: { nombre: true, puestos: true } },
            }
          });
        } else if (c.tipo_reserva === 'habitacion') {
          reservaDetalle = await prisma.reservas_habitacion.findUnique({
            where: { id: c.reserva_id },
            include: {
              habitaciones: {
                include: { sucursales: { select: { id: true, nombre: true, ciudades: { select: { nombre: true } } } } }
              }
            }
          });
        } else if (c.tipo_reserva === 'visita') {
          reservaDetalle = await prisma.reservas_visita.findUnique({
            where: { id: c.reserva_id },
            include: {
              sucursales: { select: { id: true, nombre: true, ciudades: { select: { nombre: true } } } },
            }
          });
        }

        return {
          id: c.id,
          reserva_id: c.reserva_id,
          tipo_reserva: c.tipo_reserva,
          estado: c.estado,
          fecha_creacion: c.fecha_creacion,
          compartido_con: c.compartido_con,
          reserva: reservaDetalle,
        };
      })
    );

    res.json(resultado);
  } catch (error) {
    console.error('Error obteniendo reservas enviadas:', error);
    res.status(500).json({ error: 'Error al obtener reservas enviadas' });
  }
};

// PATCH /api/reservas-compartidas/:id  { estado: 'aceptada' | 'rechazada' }
export const responderCompartida = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const nuevoEstado = String(req.body?.estado ?? '');

    if (!['aceptada', 'rechazada'].includes(nuevoEstado)) {
      return res.status(400).json({ error: 'estado debe ser: aceptada o rechazada' });
    }

    const compartida = await prisma.reservas_compartidas.findFirst({
      where: { id, compartido_con_usuario_id: req.user.id },
      include: { compartido_por: { select: { id: true, nombres: true } } }
    });
    if (!compartida) return res.status(404).json({ error: 'Compartida no encontrada' });

    const actualizada = await prisma.reservas_compartidas.update({
      where: { id },
      data: { estado: nuevoEstado }
    });

    // Notificar al que compartió
    await prisma.notificaciones.create({
      data: {
        usuario_id: compartida.compartido_por_usuario_id,
        tipo: 'compartir',
        titulo: nuevoEstado === 'aceptada' ? 'Reserva aceptada' : 'Reserva rechazada',
        mensaje: `${req.user.nombres} ${nuevoEstado === 'aceptada' ? 'aceptó' : 'rechazó'} la reserva que le compartiste.`,
        enlace: '/mis-reservas',
      }
    });

    res.json(actualizada);
  } catch (error) {
    console.error('Error respondiendo compartida:', error);
    res.status(500).json({ error: 'Error al responder' });
  }
};
