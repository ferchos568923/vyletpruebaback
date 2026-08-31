import { Request, Response } from 'express';
import { prisma } from '../services/prisma.js';
import { canGestionarSucursal } from '../middlewares/auth.js';
import { permiteReservas } from '../services/planes.service.js';
import { estadoAbierto } from '../services/horario.service.js';

const estadosValidos = ['pendiente', 'confirmada', 'cancelada', 'completada'];
const estadosOcupan = { notIn: ['cancelada'] };

const usuarioSelect = {
  id: true,
  nombres: true,
  apellidos: true,
  correo: true,
  telefono: true,
  cedula: true
};

const parseRango = (req: Request, defDias: number) => {
  const desde = req.query.desde ? new Date(String(req.query.desde)) : new Date();
  const hasta = req.query.hasta
    ? new Date(String(req.query.hasta))
    : new Date(desde.getTime() + defDias * 24 * 60 * 60 * 1000);
  return { desde, hasta };
};

const conImagenes = {
  habitacion_imagenes: { orderBy: { id: 'asc' as const } }
};

// ¿El negocio de esta sucursal permite habitaciones (hoteles/hospedaje)?
const esHospedaje = async (sucursalId: number): Promise<boolean> => {
  const s = await prisma.sucursales.findUnique({
    where: { id: sucursalId },
    select: { empresas: { select: { categorias_negocio: { select: { permite_habitaciones: true } } } } }
  });
  return s?.empresas?.categorias_negocio?.permite_habitaciones === true;
};

// Normaliza y valida la lista de imágenes (1 a 5)
const validarImagenes = (imagenes: unknown): string[] | null => {
  if (imagenes === undefined) return null; // no se envía → no se toca
  if (!Array.isArray(imagenes) || imagenes.length < 1 || imagenes.length > 5) return [];
  const limpias = imagenes.map((u) => String(u).trim()).filter((u) => u !== '');
  if (limpias.length < 1) return [];
  return limpias;
};

const reemplazarImagenes = async (habitacionId: number, urls: string[]) => {
  await prisma.habitacion_imagenes.deleteMany({ where: { habitacion_id: habitacionId } });
  if (urls.length === 0) return;
  await prisma.habitacion_imagenes.createMany({
    data: urls.map((imagen, i) => ({ habitacion_id: habitacionId, imagen, principal: i === 0 }))
  });
};

// GET /api/sucursales/:id/habitaciones  (público; solo hoteles/hospedaje)
export const listarHabitaciones = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    if (!(await esHospedaje(sucursalId))) return res.json([]);
    const habitaciones = await prisma.habitaciones.findMany({
      where: { sucursal_id: sucursalId, activa: true },
      orderBy: { id: 'asc' },
      include: conImagenes
    });
    res.json(habitaciones);
  } catch (error) {
    console.error('Error listando habitaciones:', error);
    res.status(500).json({ error: 'Error al listar habitaciones' });
  }
};

// POST /api/sucursales/:id/habitaciones  (dueño/staff/empleado con gestionar_habitaciones; solo hoteles/hospedaje)
export const crearHabitacion = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId } });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await esHospedaje(sucursalId))) return res.status(404).json({ error: 'Habitaciones no disponibles para este negocio' });
    if (!(await canGestionarSucursal(req, sucursal))) {
      return res.status(403).json({ error: 'No puedes gestionar habitaciones de esta sucursal' });
    }

    const { nombre, capacidad, precio, cantidad, imagenes } = req.body ?? {};
    if (!nombre || String(nombre).trim() === '') {
      return res.status(400).json({ error: 'nombre es requerido' });
    }
    const cant = cantidad != null ? Number(cantidad) : 1;
    if (!Number.isInteger(cant) || cant < 1) {
      return res.status(400).json({ error: 'cantidad debe ser un número entero mayor o igual a 1' });
    }
    const urls = validarImagenes(imagenes);
    if (urls === null || urls.length === 0) {
      return res.status(400).json({ error: 'La habitación debe tener entre 1 y 5 fotos' });
    }

    const habitacion = await prisma.habitaciones.create({
      data: {
        sucursal_id: sucursalId,
        nombre: String(nombre).trim(),
        capacidad: capacidad != null ? Number(capacidad) : null,
        precio: precio != null ? Number(precio) : null,
        cantidad: cant,
        activa: true
      }
    });
    await reemplazarImagenes(habitacion.id, urls);
    const conFotos = await prisma.habitaciones.findUnique({ where: { id: habitacion.id }, include: conImagenes });
    res.status(201).json(conFotos);
  } catch (error) {
    console.error('Error creando habitación:', error);
    res.status(500).json({ error: 'Error al crear habitación' });
  }
};

// PATCH /api/habitaciones/:id
export const actualizarHabitacion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const h = await prisma.habitaciones.findUnique({
      where: { id },
      include: { sucursales: { select: { id: true, empresa_id: true } } }
    });
    if (!h) return res.status(404).json({ error: 'Habitación no encontrada' });
    if (!(await esHospedaje(h.sucursales.id))) return res.status(404).json({ error: 'Habitaciones no disponibles para este negocio' });
    if (!(await canGestionarSucursal(req, h.sucursales))) {
      return res.status(403).json({ error: 'No puedes gestionar habitaciones de esta sucursal' });
    }

    const data: any = {};
    if (req.body.nombre !== undefined) {
      if (String(req.body.nombre).trim() === '') return res.status(400).json({ error: 'nombre no puede estar vacío' });
      data.nombre = String(req.body.nombre).trim();
    }
    if (req.body.capacidad !== undefined) data.capacidad = req.body.capacidad === null ? null : Number(req.body.capacidad);
    if (req.body.precio !== undefined) data.precio = req.body.precio === null ? null : Number(req.body.precio);
    if (req.body.cantidad !== undefined) {
      const cant = Number(req.body.cantidad);
      if (!Number.isInteger(cant) || cant < 1) {
        return res.status(400).json({ error: 'cantidad debe ser un número entero mayor o igual a 1' });
      }
      data.cantidad = cant;
    }
    if (req.body.activa !== undefined) data.activa = req.body.activa === true;

    if (req.body.imagenes !== undefined) {
      const urls = validarImagenes(req.body.imagenes);
      if (urls === null || urls.length === 0) {
        return res.status(400).json({ error: 'La habitación debe tener entre 1 y 5 fotos' });
      }
      await reemplazarImagenes(id, urls);
    }

    const actualizada = await prisma.habitaciones.update({
      where: { id },
      data,
      include: conImagenes
    });
    res.json(actualizada);
  } catch (error) {
    console.error('Error actualizando habitación:', error);
    res.status(500).json({ error: 'Error al actualizar habitación' });
  }
};

// DELETE /api/habitaciones/:id  (soft)
export const eliminarHabitacion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const h = await prisma.habitaciones.findUnique({
      where: { id },
      include: { sucursales: { select: { id: true, empresa_id: true } } }
    });
    if (!h) return res.status(404).json({ error: 'Habitación no encontrada' });
    if (!(await esHospedaje(h.sucursales.id))) return res.status(404).json({ error: 'Habitaciones no disponibles para este negocio' });
    if (!(await canGestionarSucursal(req, h.sucursales))) {
      return res.status(403).json({ error: 'No puedes gestionar habitaciones de esta sucursal' });
    }
    await prisma.habitaciones.update({ where: { id }, data: { activa: false } });
    res.json({ message: 'Habitación desactivada' });
  } catch (error) {
    console.error('Error eliminando habitación:', error);
    res.status(500).json({ error: 'Error al eliminar habitación' });
  }
};

// GET /api/sucursales/:id/habitaciones/disponibilidad?desde&hasta  (público; solo hoteles/hospedaje)
export const disponibilidadSucursal = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const { desde, hasta } = parseRango(req, 30);
    if (!(await esHospedaje(sucursalId))) return res.json({ desde, hasta, habitaciones: [] });
    const habitaciones = await prisma.habitaciones.findMany({
      where: { sucursal_id: sucursalId, activa: true },
      orderBy: { id: 'asc' },
      include: {
        habitacion_imagenes: { orderBy: { id: 'asc' } },
        reservas_habitacion: {
          where: {
            estado: estadosOcupan,
            fecha_entrada: { lt: hasta },
            fecha_salida: { gt: desde }
          },
          select: {
            id: true,
            fecha_entrada: true,
            fecha_salida: true,
            estado: true,
            personas: true,
            origen: true,
            cliente_nombre: true,
            cliente_telefono: true,
            usuarios: { select: usuarioSelect }
          }
        }
      }
    });
    res.json({ desde, hasta, habitaciones });
  } catch (error) {
    console.error('Error obteniendo disponibilidad:', error);
    res.status(500).json({ error: 'Error al obtener disponibilidad' });
  }
};

// POST /api/habitaciones/:id/reservas  (cliente autenticado, vía la app)
export const crearReservaHabitacion = async (req: Request, res: Response) => {
  try {
    const habitacionId = Number(req.params.id);
    const h = await prisma.habitaciones.findFirst({ where: { id: habitacionId, activa: true } });
    if (!h) return res.status(404).json({ error: 'Habitación no encontrada' });
    if (!(await esHospedaje(h.sucursal_id))) return res.status(404).json({ error: 'Habitaciones no disponibles para este negocio' });

    const sucursalHab = await prisma.sucursales.findUnique({ where: { id: h.sucursal_id }, select: { empresa_id: true, horario: true } });
    if (!sucursalHab) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await permiteReservas(sucursalHab.empresa_id))) {
      return res.status(403).json({ error: 'Las reservas solo están disponibles en el plan Premium o superior. Actualiza tu plan.' });
    }

    const { fecha_entrada, fecha_salida, personas, cantidad } = req.body ?? {};
    if (!fecha_entrada || !fecha_salida) {
      return res.status(400).json({ error: 'fecha_entrada y fecha_salida son requeridas' });
    }
    const entrada = new Date(String(fecha_entrada));
    const salida = new Date(String(fecha_salida));
    if (isNaN(entrada.getTime()) || isNaN(salida.getTime())) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }
    if (salida <= entrada) {
      return res.status(400).json({ error: 'fecha_salida debe ser posterior a fecha_entrada' });
    }
    const personasNum = personas != null ? Number(personas) : 1;
    if (personasNum < 1) return res.status(400).json({ error: 'El número de personas debe ser al menos 1' });
    if (h.capacidad != null && personasNum > h.capacidad) {
      return res.status(400).json({ error: `La habitación solo permite hasta ${h.capacidad} personas` });
    }
    const cantNum = cantidad != null ? Number(cantidad) : 1;
    if (!Number.isInteger(cantNum) || cantNum < 1) {
      return res.status(400).json({ error: 'La cantidad debe ser un entero mayor o igual a 1' });
    }

    const solapadas = await prisma.reservas_habitacion.count({
      where: {
        habitacion_id: habitacionId,
        estado: estadosOcupan,
        fecha_entrada: { lt: salida },
        fecha_salida: { gt: entrada }
      }
    });
    if (solapadas + cantNum > (h.cantidad ?? 1)) {
      return res.status(409).json({ error: 'No hay disponibilidad en esas fechas' });
    }

    const creadas = await prisma.$transaction(
      Array.from({ length: cantNum }).map(() =>
        prisma.reservas_habitacion.create({
          data: {
            habitacion_id: habitacionId,
            usuario_id: req.user.id,
            fecha_entrada: entrada,
            fecha_salida: salida,
            personas: personasNum,
            estado: 'pendiente',
            origen: 'app'
          },
          include: {
            habitaciones: { include: { sucursales: { include: { empresas: { select: { nombre: true } } } } } }
          }
        })
      )
    );
    res.status(201).json(cantNum > 1 ? { reservas: creadas } : creadas[0]);
  } catch (error) {
    console.error('Error creando reserva de habitación:', error);
    res.status(500).json({ error: 'Error al crear reserva de habitación' });
  }
};

// POST /api/sucursales/:id/reservas-habitacion/multi  (cliente autenticado, vía la app; reserva varias habitaciones a la vez)
export const crearReservaHabitacionMulti = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, activo: true } });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await esHospedaje(sucursalId))) return res.status(404).json({ error: 'Habitaciones no disponibles para este negocio' });
    if (!(await permiteReservas(sucursal.empresa_id))) {
      return res.status(403).json({ error: 'Las reservas solo están disponibles en el plan Premium o superior. Actualiza tu plan.' });
    }

    const { habitacion_ids, fecha_entrada, fecha_salida, personas, cantidades } = req.body ?? {};
    if (!Array.isArray(habitacion_ids) || habitacion_ids.length === 0) {
      return res.status(400).json({ error: 'habitacion_ids es requerido' });
    }
    const ids = [...new Set(habitacion_ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))];
    if (ids.length !== habitacion_ids.length) {
      return res.status(400).json({ error: 'Lista de habitaciones inválida' });
    }
    if (!fecha_entrada || !fecha_salida) {
      return res.status(400).json({ error: 'fecha_entrada y fecha_salida son requeridas' });
    }
    const entrada = new Date(String(fecha_entrada));
    const salida = new Date(String(fecha_salida));
    if (isNaN(entrada.getTime()) || isNaN(salida.getTime())) {
      return res.status(400).json({ error: 'Fechas inválidas' });
    }
    if (salida <= entrada) {
      return res.status(400).json({ error: 'fecha_salida debe ser posterior a fecha_entrada' });
    }

    const habitaciones = await prisma.habitaciones.findMany({
      where: { id: { in: ids }, sucursal_id: sucursalId, activa: true }
    });
    if (habitaciones.length !== ids.length) {
      return res.status(404).json({ error: 'Una de las habitaciones no existe o está inactiva' });
    }

    let personasPorHab: number[];
    if (Array.isArray(personas)) {
      if (personas.length !== ids.length) {
        return res.status(400).json({ error: 'personas debe ser un número o una lista alineada con las habitaciones' });
      }
      personasPorHab = personas.map(Number);
    } else {
      const p = personas != null ? Number(personas) : 1;
      personasPorHab = ids.map(() => p);
    }

    let cantPorHab: number[];
    if (Array.isArray(cantidades)) {
      if (cantidades.length !== ids.length) {
        return res.status(400).json({ error: 'cantidades debe ser un número o una lista alineada con las habitaciones' });
      }
      cantPorHab = cantidades.map(Number);
    } else {
      const c = cantidades != null ? Number(cantidades) : 1;
      cantPorHab = ids.map(() => c);
    }

    const ocupadas: string[] = [];
    for (const h of habitaciones) {
      const idx = ids.indexOf(h.id);
      const np = personasPorHab[idx];
      const nc = cantPorHab[idx];
      if (!Number.isInteger(np) || np < 1) {
        return res.status(400).json({ error: 'El número de personas debe ser un entero mayor o igual a 1' });
      }
      if (h.capacidad != null && np > h.capacidad) {
        return res.status(400).json({ error: `La habitación "${h.nombre ?? 'Sin nombre'}" solo permite hasta ${h.capacidad} personas` });
      }
      if (!Number.isInteger(nc) || nc < 1) {
        return res.status(400).json({ error: 'La cantidad debe ser un entero mayor o igual a 1' });
      }
      const solapadas = await prisma.reservas_habitacion.count({
        where: {
          habitacion_id: h.id,
          estado: estadosOcupan,
          fecha_entrada: { lt: salida },
          fecha_salida: { gt: entrada }
        }
      });
      if (solapadas + nc > (h.cantidad ?? 1)) ocupadas.push(h.nombre ?? `#${h.id}`);
    }
    if (ocupadas.length) {
      return res.status(409).json({ error: `Sin disponibilidad en esas fechas para: ${ocupadas.join(', ')}` });
    }

    const creadas = await prisma.$transaction(
      ids.flatMap((hid) => {
        const idx = ids.indexOf(hid);
        const repeticiones = Array.from({ length: cantPorHab[idx] });
        return repeticiones.map(() =>
          prisma.reservas_habitacion.create({
            data: {
              habitacion_id: hid,
              usuario_id: req.user.id,
              fecha_entrada: entrada,
              fecha_salida: salida,
              personas: personasPorHab[idx],
              estado: 'pendiente',
              origen: 'app'
            },
            include: {
              habitaciones: { include: { sucursales: { include: { empresas: { select: { nombre: true } } } } } }
            }
          })
        );
      })
    );
    res.status(201).json({ reservas: creadas });
  } catch (error) {
    console.error('Error creando reserva múltiple de habitaciones:', error);
    res.status(500).json({ error: 'Error al crear las reservas' });
  }
};

// POST /api/sucursales/:id/reservas-habitacion  (dueño/staff: registra reserva recibida por whatsapp/teléfono/redes)
export const crearReservaManual = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId } });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await esHospedaje(sucursalId))) return res.status(404).json({ error: 'Habitaciones no disponibles para este negocio' });
    if (!(await canGestionarSucursal(req, sucursal))) {
      return res.status(403).json({ error: 'No puedes gestionar habitaciones de esta sucursal' });
    }
    if (!(await permiteReservas(sucursal.empresa_id))) {
      return res.status(403).json({ error: 'Las reservas solo están disponibles en el plan Premium o superior. Actualiza tu plan.' });
    }

    const { habitacion_id, fecha_entrada, fecha_salida, personas, origen, cliente_nombre, cliente_telefono } = req.body ?? {};
    if (!habitacion_id || !fecha_entrada || !fecha_salida) {
      return res.status(400).json({ error: 'habitacion_id, fecha_entrada y fecha_salida son requeridos' });
    }
    const habitacion = await prisma.habitaciones.findFirst({
      where: { id: Number(habitacion_id), sucursal_id: sucursalId, activa: true }
    });
    if (!habitacion) return res.status(404).json({ error: 'Habitación no encontrada en esta sucursal' });

    const entrada = new Date(String(fecha_entrada));
    const salida = new Date(String(fecha_salida));
    if (isNaN(entrada.getTime()) || isNaN(salida.getTime())) return res.status(400).json({ error: 'Fechas inválidas' });
    if (salida <= entrada) return res.status(400).json({ error: 'fecha_salida debe ser posterior a fecha_entrada' });
    const personasNum = personas != null ? Number(personas) : 1;
    if (personasNum < 1) return res.status(400).json({ error: 'El número de personas debe ser al menos 1' });
    if (habitacion.capacidad != null && personasNum > habitacion.capacidad) {
      return res.status(400).json({ error: `La habitación solo permite hasta ${habitacion.capacidad} personas` });
    }

    const solapadas = await prisma.reservas_habitacion.count({
      where: {
        habitacion_id: habitacion.id,
        estado: estadosOcupan,
        fecha_entrada: { lt: salida },
        fecha_salida: { gt: entrada }
      }
    });
    if (solapadas >= (habitacion.cantidad ?? 1)) {
      return res.status(409).json({ error: 'No hay disponibilidad en esas fechas' });
    }

    const reserva = await prisma.reservas_habitacion.create({
      data: {
        habitacion_id: habitacion.id,
        usuario_id: req.user.id,
        fecha_entrada: entrada,
        fecha_salida: salida,
        personas: personasNum,
        estado: 'confirmada',
        origen: origen != null && origen !== '' ? String(origen) : 'presencial',
        cliente_nombre: cliente_nombre != null ? String(cliente_nombre) : null,
        cliente_telefono: cliente_telefono != null ? String(cliente_telefono) : null
      },
      include: { habitaciones: { select: { id: true, nombre: true } } }
    });
    res.status(201).json(reserva);
  } catch (error) {
    console.error('Error registrando reserva manual:', error);
    res.status(500).json({ error: 'Error al registrar la reserva' });
  }
};

// GET /api/sucursales/:id/reservas-habitacion?desde&hasta  (dueño/staff/empleado con gestionar_habitaciones)
export const listarReservasSucursal = async (req: Request, res: Response) => {
  try {
    const sucursalId = Number(req.params.id);
    const sucursal = await prisma.sucursales.findUnique({ where: { id: sucursalId } });
    if (!sucursal) return res.status(404).json({ error: 'Sucursal no encontrada' });
    if (!(await esHospedaje(sucursalId))) return res.status(404).json({ error: 'Habitaciones no disponibles para este negocio' });
    if (!(await canGestionarSucursal(req, sucursal))) {
      return res.status(403).json({ error: 'No puedes ver las reservas de habitaciones de esta sucursal' });
    }

    const { desde, hasta } = parseRango(req, 30);
    const reservas = await prisma.reservas_habitacion.findMany({
      where: {
        habitaciones: { sucursal_id: sucursalId },
        estado: estadosOcupan,
        fecha_entrada: { lt: hasta },
        fecha_salida: { gt: desde }
      },
      orderBy: { fecha_entrada: 'asc' },
      include: {
        habitaciones: { select: { id: true, nombre: true } },
        usuarios: { select: usuarioSelect }
      }
    });
    res.json({ desde, hasta, reservas });
  } catch (error) {
    console.error('Error listando reservas de habitaciones:', error);
    res.status(500).json({ error: 'Error al listar reservas de habitaciones' });
  }
};

// PATCH /api/reservas-habitacion/:id  { estado }
export const cambiarEstadoReservaHabitacion = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const r = await prisma.reservas_habitacion.findUnique({
      where: { id },
      include: {
        habitaciones: { include: { sucursales: { select: { id: true, empresa_id: true } } } }
      }
    });
    if (!r) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (!(await esHospedaje(r.habitaciones.sucursal_id))) return res.status(404).json({ error: 'Habitaciones no disponibles para este negocio' });
    if (!(await canGestionarSucursal(req, r.habitaciones.sucursales))) {
      return res.status(403).json({ error: 'No puedes gestionar estas reservas' });
    }

    const { estado } = req.body ?? {};
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: `estado inválido. Valores: ${estadosValidos.join(', ')}` });
    }

    const actualizada = await prisma.reservas_habitacion.update({ where: { id }, data: { estado } });
    res.json(actualizada);
  } catch (error) {
    console.error('Error actualizando reserva de habitación:', error);
    res.status(500).json({ error: 'Error al actualizar reserva de habitación' });
  }
};

// GET /api/usuarios/mis-reservas-habitacion
export const misReservasHabitacion = async (req: Request, res: Response) => {
  try {
    const reservas = await prisma.reservas_habitacion.findMany({
      where: { usuario_id: req.user.id },
      orderBy: { fecha_entrada: 'desc' },
      include: {
        habitaciones: {
          select: {
            id: true, nombre: true, precio: true, capacidad: true,
            sucursales: { select: { id: true, nombre: true, ciudades: { select: { nombre: true } } } }
          }
        }
      }
    });
    res.json(reservas);
  } catch (error) {
    console.error('Error listando mis reservas de habitación:', error);
    res.status(500).json({ error: 'Error al listar reservas' });
  }
};