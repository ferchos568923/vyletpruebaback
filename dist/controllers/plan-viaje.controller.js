import { prisma } from '../services/prisma.js';
import crypto from 'crypto';
const incluirSucursales = {
    sucursales: {
        include: {
            ciudades: { select: { id: true, nombre: true } },
            empresas: {
                select: { id: true, nombre: true, logo: true, categorias_negocio: { select: { nombre: true, permite_habitaciones: true, permite_mesas: true } } }
            }
        }
    }
};
const incluirPlan = {
    usuarios: { select: { id: true, nombres: true, apellidos: true } },
    ciudades: { select: { id: true, nombre: true } },
    amigos: {
        select: {
            id: true,
            usuario_id: true,
            usuarios: { select: { id: true, nombres: true, apellidos: true, cedula: true } }
        }
    },
    eventos: {
        include: {
            eventos: {
                include: {
                    ciudades: { select: { id: true, nombre: true } },
                    categorias_evento: { select: { id: true, nombre: true } }
                }
            }
        }
    },
    sucursales: { include: incluirSucursales }
};
// Precio estimado de un evento dentro del plan (por persona aprox.)
function precioEstimadoEvento(evento) {
    return evento.precio_desde !== null && evento.precio_desde !== undefined ? Number(evento.precio_desde) : 0;
}
// Decora un plan con los precios estimados de sus lugares y eventos, y el total combinado.
async function planConPrecios(plan, esMio) {
    const sucursales = await Promise.all((plan.sucursales ?? []).map(async (ps) => ({
        ...ps,
        precio_estimado: await precioEstimadoSucursal(ps.sucursales)
    })));
    const eventos = (plan.eventos ?? []).map((pe) => ({
        ...pe,
        precio_estimado: precioEstimadoEvento(pe.eventos)
    }));
    const total = [...sucursales.map((s) => s.precio_estimado ?? 0), ...eventos.map((e) => e.precio_estimado)].reduce((a, b) => a + b, 0);
    return {
        ...plan,
        ...(esMio !== undefined ? { es_mio: esMio } : {}),
        sucursales,
        eventos,
        total_estimado: total
    };
}
// Precio estimado por persona (aproximado) de una sucursal dentro de un plan.
// Prioridad: entrada turística -> habitación más barata/noche -> plato más barato.
async function precioEstimadoSucursal(sucursal) {
    if (sucursal.gratuito === true)
        return 0;
    const entrada = sucursal.precio_adultos !== null && sucursal.precio_adultos !== undefined ? Number(sucursal.precio_adultos) : null;
    if (entrada !== null && entrada > 0)
        return entrada;
    const hab = await prisma.habitaciones.findFirst({
        where: { sucursal_id: sucursal.id, activa: true, NOT: { precio: null } },
        orderBy: { precio: 'asc' }
    });
    if (hab?.precio != null)
        return Number(hab.precio);
    const prod = await prisma.productos_servicios.findFirst({
        where: { sucursal_id: sucursal.id, activo: true },
        orderBy: { precio: 'asc' }
    });
    if (prod?.precio != null)
        return Number(prod.precio);
    return 0;
}
function generarCodigo() {
    return crypto.randomBytes(5).toString('base64url').slice(0, 8).toUpperCase();
}
// Tipos de viaje disponibles para catalogar los planes
const TIPOS_VIAJE = ['playa', 'montaña', 'ciudad', 'campo', 'aventura', 'cultura', 'gastronomía', 'descanso', 'otro'];
// Imagen representativa por tipo de viaje (para las tarjetas de los planes)
const IMAGENES_TIPO = {
    playa: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80&auto=format&fit=crop',
    'montaña': 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1200&q=80&auto=format&fit=crop',
    ciudad: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1200&q=80&auto=format&fit=crop',
    campo: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80&auto=format&fit=crop',
    aventura: 'https://images.unsplash.com/photo-1461896836934-ffe607ba8211?w=1200&q=80&auto=format&fit=crop',
    cultura: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200&q=80&auto=format&fit=crop',
    'gastronomía': 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80&auto=format&fit=crop',
    descanso: 'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=1200&q=80&auto=format&fit=crop',
    otro: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=80&auto=format&fit=crop'
};
function tipoValido(tipo) {
    if (tipo === undefined || tipo === null || tipo === '')
        return undefined;
    const t = String(tipo).trim().toLowerCase();
    return TIPOS_VIAJE.includes(t) ? t : undefined;
}
// GET /api/planes-viaje/tipos  (público)
export const listarTipos = async (_req, res) => {
    res.json(TIPOS_VIAJE);
};
// GET /api/planes-viaje/sucursales?q=  (público: lista sucursales activas para armar planes)
export const listarSucursalesDisponibles = async (req, res) => {
    try {
        const q = String(req.query.q ?? '').trim().toLowerCase();
        const where = {
            activo: true,
            empresas: { activo: true }
        };
        if (q) {
            where.OR = [
                { nombre: { contains: q, mode: 'insensitive' } },
                { empresas: { nombre: { contains: q, mode: 'insensitive' } } },
                { ciudades: { nombre: { contains: q, mode: 'insensitive' } } }
            ];
        }
        const sucursales = await prisma.sucursales.findMany({
            where,
            orderBy: { calificacion: 'desc' },
            take: 50,
            include: {
                ciudades: { select: { id: true, nombre: true } },
                empresas: { select: { id: true, nombre: true, logo: true, categorias_negocio: { select: { nombre: true, permite_habitaciones: true, permite_mesas: true, permite_reservas: true } } } }
            }
        });
        res.json(sucursales);
    }
    catch (error) {
        console.error('Error listando sucursales disponibles:', error);
        res.status(500).json({ error: 'Error al listar sucursales disponibles' });
    }
};
// POST /api/planes-viaje  (autenticado)
export const crear = async (req, res) => {
    try {
        const { nombre, descripcion, tipo, cantidad_personas, ciudad_id } = req.body;
        if (!nombre || !String(nombre).trim()) {
            return res.status(400).json({ error: 'El nombre del plan es requerido' });
        }
        const tipoPlan = tipoValido(tipo);
        if (tipo !== undefined && tipo !== null && tipo !== '' && !tipoPlan) {
            return res.status(400).json({ error: `Tipo de viaje no válido. Usa uno de: ${TIPOS_VIAJE.join(', ')}` });
        }
        let personas;
        if (cantidad_personas !== undefined && cantidad_personas !== null && cantidad_personas !== '') {
            personas = Number(cantidad_personas);
            if (!Number.isInteger(personas) || personas < 1) {
                return res.status(400).json({ error: 'cantidad_personas debe ser un número mayor a 0' });
            }
        }
        let ciudadId;
        if (ciudad_id !== undefined && ciudad_id !== null && ciudad_id !== '') {
            ciudadId = Number(ciudad_id);
            const ciudad = await prisma.ciudades.findFirst({ where: { id: ciudadId, activo: true } });
            if (!ciudad)
                return res.status(400).json({ error: 'La ciudad seleccionada no existe' });
        }
        const plan = await prisma.planes_viaje.create({
            data: {
                usuario_id: req.user.id,
                nombre: String(nombre).trim(),
                tipo: tipoPlan ?? null,
                cantidad_personas: personas,
                imagen: tipoPlan ? IMAGENES_TIPO[tipoPlan] : null,
                ciudad_id: ciudadId,
                descripcion: descripcion ? String(descripcion).trim() : null,
                codigo: generarCodigo()
            },
            include: incluirPlan
        });
        res.status(201).json(plan);
    }
    catch (error) {
        console.error('Error creando plan de viaje:', error);
        res.status(500).json({ error: 'Error al crear plan de viaje' });
    }
};
// GET /api/planes-viaje  (autenticado: propios + donde me incluyeron)
export const listarMios = async (req, res) => {
    try {
        const planes = await prisma.planes_viaje.findMany({
            where: {
                OR: [{ usuario_id: req.user.id }, { amigos: { some: { usuario_id: req.user.id } } }]
            },
            orderBy: { fecha_creacion: 'desc' },
            include: incluirPlan
        });
        const conPrecio = await Promise.all(planes.map((p) => planConPrecios(p, p.usuario_id === req.user.id)));
        res.json(conPrecio);
    }
    catch (error) {
        console.error('Error listando planes de viaje:', error);
        res.status(500).json({ error: 'Error al listar planes de viaje' });
    }
};
// GET /api/planes-viaje/:id  (autenticado dueño o amigo incluido)
export const obtener = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const plan = await prisma.planes_viaje.findFirst({
            where: {
                id,
                OR: [{ usuario_id: req.user.id }, { amigos: { some: { usuario_id: req.user.id } } }]
            },
            include: incluirPlan
        });
        if (!plan)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        res.json(await planConPrecios(plan, plan.usuario_id === req.user.id));
    }
    catch (error) {
        console.error('Error obteniendo plan de viaje:', error);
        res.status(500).json({ error: 'Error al obtener plan de viaje' });
    }
};
// PATCH /api/planes-viaje/:id  (autenticado dueño)
export const actualizar = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { nombre, descripcion, tipo, cantidad_personas, ciudad_id } = req.body;
        const existe = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!existe)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        const tipoPlan = tipoValido(tipo);
        if (tipo !== undefined && tipo !== null && tipo !== '' && !tipoPlan) {
            return res.status(400).json({ error: `Tipo de viaje no válido. Usa uno de: ${TIPOS_VIAJE.join(', ')}` });
        }
        let personas;
        if (cantidad_personas !== undefined && cantidad_personas !== null && cantidad_personas !== '') {
            personas = Number(cantidad_personas);
            if (!Number.isInteger(personas) || personas < 1) {
                return res.status(400).json({ error: 'cantidad_personas debe ser un número mayor a 0' });
            }
        }
        let ciudadId;
        if (ciudad_id !== undefined) {
            if (ciudad_id === null || ciudad_id === '') {
                ciudadId = null;
            }
            else {
                ciudadId = Number(ciudad_id);
                const ciudad = await prisma.ciudades.findFirst({ where: { id: ciudadId, activo: true } });
                if (!ciudad)
                    return res.status(400).json({ error: 'La ciudad seleccionada no existe' });
            }
        }
        const plan = await prisma.planes_viaje.update({
            where: { id },
            data: {
                nombre: nombre !== undefined ? String(nombre).trim() : undefined,
                tipo: tipo !== undefined ? (tipoPlan ?? null) : undefined,
                cantidad_personas: cantidad_personas !== undefined ? (personas ?? null) : undefined,
                imagen: tipo !== undefined ? (tipoPlan ? IMAGENES_TIPO[tipoPlan] : null) : undefined,
                ciudad_id: ciudadId,
                descripcion: descripcion !== undefined ? (descripcion ? String(descripcion).trim() : null) : undefined
            },
            include: incluirPlan
        });
        res.json(plan);
    }
    catch (error) {
        console.error('Error actualizando plan de viaje:', error);
        res.status(500).json({ error: 'Error al actualizar plan de viaje' });
    }
};
// DELETE /api/planes-viaje/:id  (autenticado dueño)
export const eliminar = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existe = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!existe)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        await prisma.$transaction([
            prisma.plan_viaje_amigos.deleteMany({ where: { plan_id: id } }),
            prisma.plan_viaje_sucursales.deleteMany({ where: { plan_id: id } }),
            prisma.plan_viaje_eventos.deleteMany({ where: { plan_id: id } }),
            prisma.planes_viaje.delete({ where: { id } })
        ]);
        res.json({ message: 'Plan de viaje eliminado' });
    }
    catch (error) {
        console.error('Error eliminando plan de viaje:', error);
        res.status(500).json({ error: 'Error al eliminar plan de viaje' });
    }
};
// POST /api/planes-viaje/:id/sucursales  (autenticado dueño)  { sucursal_id }
export const agregarSucursal = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const sucursalId = Number(req.body.sucursal_id);
        if (!Number.isInteger(sucursalId) || sucursalId <= 0) {
            return res.status(400).json({ error: 'sucursal_id es requerido' });
        }
        const plan = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!plan)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, activo: true } });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada o inactiva' });
        const yaEsta = await prisma.plan_viaje_sucursales.findFirst({ where: { plan_id: id, sucursal_id: sucursalId } });
        if (!yaEsta) {
            await prisma.plan_viaje_sucursales.create({ data: { plan_id: id, sucursal_id: sucursalId } });
        }
        const actualizado = await prisma.planes_viaje.findUnique({ where: { id }, include: incluirPlan });
        const detalles = await Promise.all((actualizado?.sucursales ?? []).map(async (ps) => ({
            ...ps,
            precio_estimado: await precioEstimadoSucursal(ps.sucursales)
        })));
        res.status(201).json({ ...actualizado, sucursales: detalles, total_estimado: detalles.reduce((acc, d) => acc + (d.precio_estimado ?? 0), 0) });
    }
    catch (error) {
        console.error('Error agregando sucursal al plan:', error);
        res.status(500).json({ error: 'Error al agregar sucursal al plan' });
    }
};
// DELETE /api/planes-viaje/:id/sucursales/:sucursalId  (autenticado dueño)
export const quitarSucursal = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const sucursalId = Number(req.params.sucursalId);
        const plan = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!plan)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        await prisma.plan_viaje_sucursales.deleteMany({ where: { plan_id: id, sucursal_id: sucursalId } });
        const actualizado = await prisma.planes_viaje.findUnique({ where: { id }, include: incluirPlan });
        const detalles = await Promise.all((actualizado?.sucursales ?? []).map(async (ps) => ({
            ...ps,
            precio_estimado: await precioEstimadoSucursal(ps.sucursales)
        })));
        res.json({ ...actualizado, sucursales: detalles, total_estimado: detalles.reduce((acc, d) => acc + (d.precio_estimado ?? 0), 0) });
    }
    catch (error) {
        console.error('Error quitando sucursal del plan:', error);
        res.status(500).json({ error: 'Error al quitar sucursal del plan' });
    }
};
// PATCH /api/planes-viaje/:id/publico  (autenticado dueño)  { publico: boolean }
export const cambiarPublico = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const publico = Boolean(req.body.publico);
        const existe = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!existe)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        const plan = await prisma.planes_viaje.update({
            where: { id },
            data: { publico, codigo: publico && !existe.codigo ? generarCodigo() : existe.codigo },
            include: incluirPlan
        });
        res.json(plan);
    }
    catch (error) {
        console.error('Error cambiando visibilidad del plan:', error);
        res.status(500).json({ error: 'Error al cambiar visibilidad del plan' });
    }
};
// GET /api/planes-viaje/publicos  (público: lista planes públicos recientes)
export const listarPublicos = async (req, res) => {
    try {
        const tipo = tipoValido(req.query.tipo);
        const planes = await prisma.planes_viaje.findMany({
            where: { publico: true, ...(tipo ? { tipo } : {}) },
            orderBy: { fecha_creacion: 'desc' },
            take: 50,
            include: incluirPlan
        });
        const conPrecio = await Promise.all(planes.map((p) => planConPrecios(p)));
        res.json(conPrecio);
    }
    catch (error) {
        console.error('Error listando planes públicos:', error);
        res.status(500).json({ error: 'Error al listar planes públicos' });
    }
};
// GET /api/planes-viaje/publico/:codigo  (público)
export const obtenerPublico = async (req, res) => {
    try {
        const codigo = String(req.params.codigo || '').toUpperCase();
        const plan = await prisma.planes_viaje.findFirst({
            where: { codigo, publico: true },
            include: incluirPlan
        });
        if (!plan)
            return res.status(404).json({ error: 'Plan público no encontrado' });
        res.json(await planConPrecios(plan));
    }
    catch (error) {
        console.error('Error obteniendo plan público:', error);
        res.status(500).json({ error: 'Error al obtener plan público' });
    }
};
// POST /api/planes-viaje/publico/:codigo/copiar  (autenticado: copia el plan a "mis planes")
export const copiarPublico = async (req, res) => {
    try {
        const codigo = String(req.params.codigo || '').toUpperCase();
        const plan = await prisma.planes_viaje.findFirst({
            where: { codigo, publico: true },
            include: {
                sucursales: { select: { sucursal_id: true } },
                eventos: { select: { evento_id: true } }
            }
        });
        if (!plan)
            return res.status(404).json({ error: 'Plan público no encontrado' });
        const creado = await prisma.planes_viaje.create({
            data: {
                usuario_id: req.user.id,
                nombre: `${plan.nombre} (copia)`,
                tipo: plan.tipo,
                cantidad_personas: plan.cantidad_personas,
                imagen: plan.imagen,
                ciudad_id: plan.ciudad_id,
                descripcion: plan.descripcion,
                codigo: generarCodigo(),
                sucursales: plan.sucursales.length
                    ? { create: plan.sucursales.map((s) => ({ sucursal_id: s.sucursal_id })) }
                    : undefined,
                eventos: plan.eventos.length
                    ? { create: plan.eventos.map((e) => ({ evento_id: e.evento_id })) }
                    : undefined
            },
            include: incluirPlan
        });
        res.status(201).json(creado);
    }
    catch (error) {
        console.error('Error copiando plan público:', error);
        res.status(500).json({ error: 'Error al copiar plan público' });
    }
};
// GET /api/planes-viaje/amigos/buscar?q=  (autenticado: busca usuarios activos por cédula o nombre)
export const buscarAmigos = async (req, res) => {
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
    }
    catch (error) {
        console.error('Error buscando usuarios:', error);
        res.status(500).json({ error: 'Error al buscar usuarios' });
    }
};
// POST /api/planes-viaje/:id/amigos  { usuario_id }  (dueño del plan)
export const agregarAmigo = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const usuarioId = Number(req.body?.usuario_id);
        if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
            return res.status(400).json({ error: 'usuario_id es requerido' });
        }
        const plan = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!plan)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        const amigo = await prisma.usuarios.findFirst({ where: { id: usuarioId, activo: true } });
        if (!amigo)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        if (amigo.id === req.user.id) {
            return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });
        }
        const existe = await prisma.plan_viaje_amigos.findUnique({
            where: { plan_id_usuario_id: { plan_id: id, usuario_id: usuarioId } }
        });
        if (existe)
            return res.status(409).json({ error: 'Ese usuario ya está en el plan' });
        await prisma.$transaction([
            prisma.plan_viaje_amigos.create({ data: { plan_id: id, usuario_id: usuarioId } }),
            prisma.notificaciones.create({
                data: {
                    usuario_id: usuarioId,
                    titulo: 'Te incluyeron en un plan de viaje',
                    mensaje: `${req.user.nombres} te incluyó en su plan "${plan.nombre}". Revísalo en Mis recomendaciones.`
                }
            })
        ]);
        const actualizado = await prisma.planes_viaje.findUniqueOrThrow({
            where: { id },
            include: incluirPlan
        });
        res.status(201).json(actualizado);
    }
    catch (error) {
        console.error('Error agregando amigo al plan:', error);
        res.status(500).json({ error: 'Error al agregar amigo al plan' });
    }
};
// DELETE /api/planes-viaje/:id/amigos/:usuarioId  (dueño del plan)
export const quitarAmigo = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const usuarioId = Number(req.params.usuarioId);
        const plan = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!plan)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        await prisma.plan_viaje_amigos.deleteMany({ where: { plan_id: id, usuario_id: usuarioId } });
        const actualizado = await prisma.planes_viaje.findUniqueOrThrow({
            where: { id },
            include: incluirPlan
        });
        res.json(actualizado);
    }
    catch (error) {
        console.error('Error quitando amigo del plan:', error);
        res.status(500).json({ error: 'Error al quitar amigo del plan' });
    }
};
// GET /api/planes-viaje/eventos?q=  (público: lista eventos activos para armar planes)
export const listarEventosDisponibles = async (req, res) => {
    try {
        const q = String(req.query.q ?? '').trim();
        const where = { activo: true };
        if (q) {
            where.OR = [
                { nombre: { contains: q, mode: 'insensitive' } },
                { lugar: { contains: q, mode: 'insensitive' } },
                { ciudades: { nombre: { contains: q, mode: 'insensitive' } } }
            ];
        }
        const eventos = await prisma.eventos.findMany({
            where,
            orderBy: { fecha_inicio: 'asc' },
            take: 30,
            include: {
                ciudades: { select: { id: true, nombre: true } },
                categorias_evento: { select: { id: true, nombre: true } }
            }
        });
        res.json(eventos);
    }
    catch (error) {
        console.error('Error listando eventos disponibles:', error);
        res.status(500).json({ error: 'Error al listar eventos disponibles' });
    }
};
// POST /api/planes-viaje/:id/eventos  { evento_id }  (dueño)
export const agregarEvento = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const eventoId = Number(req.body?.evento_id);
        if (!Number.isInteger(eventoId) || eventoId <= 0) {
            return res.status(400).json({ error: 'evento_id es requerido' });
        }
        const plan = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!plan)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        const evento = await prisma.eventos.findFirst({ where: { id: eventoId, activo: true } });
        if (!evento)
            return res.status(404).json({ error: 'Evento no encontrado' });
        const existe = await prisma.plan_viaje_eventos.findUnique({
            where: { plan_id_evento_id: { plan_id: id, evento_id: eventoId } }
        });
        if (existe)
            return res.status(409).json({ error: 'Ese evento ya está en el plan' });
        await prisma.plan_viaje_eventos.create({ data: { plan_id: id, evento_id: eventoId } });
        const actualizado = await prisma.planes_viaje.findUniqueOrThrow({
            where: { id },
            include: incluirPlan
        });
        res.status(201).json(await planConPrecios(actualizado));
    }
    catch (error) {
        console.error('Error agregando evento al plan:', error);
        res.status(500).json({ error: 'Error al agregar evento al plan' });
    }
};
// DELETE /api/planes-viaje/:id/eventos/:eventoId  (dueño)
export const quitarEvento = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const eventoId = Number(req.params.eventoId);
        const plan = await prisma.planes_viaje.findFirst({ where: { id, usuario_id: req.user.id } });
        if (!plan)
            return res.status(404).json({ error: 'Plan de viaje no encontrado' });
        await prisma.plan_viaje_eventos.deleteMany({ where: { plan_id: id, evento_id: eventoId } });
        const actualizado = await prisma.planes_viaje.findUniqueOrThrow({
            where: { id },
            include: incluirPlan
        });
        res.json(await planConPrecios(actualizado));
    }
    catch (error) {
        console.error('Error quitando evento del plan:', error);
        res.status(500).json({ error: 'Error al quitar evento del plan' });
    }
};
