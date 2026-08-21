import { prisma } from '../services/prisma.js';
import { canGestionarEmpresa, canGestionarSucursal, isStaff } from '../middlewares/auth.js';
import { limiteSucursales, suscripcionActiva } from '../services/planes.service.js';
// GET /api/sucursales/turisticas  (público: sucursales de empresas categoría "Lugar Turistico")
export const listarTuristicas = async (req, res) => {
    try {
        const sucursales = await prisma.sucursales.findMany({
            where: {
                activo: true,
                empresas: { activo: true, categorias_negocio: { nombre: 'Lugar Turistico' } }
            },
            orderBy: { fecha_creacion: 'desc' },
            include: {
                ciudades: { select: { id: true, nombre: true } },
                empresas: { select: { id: true, nombre: true, logo: true, verificado: true, destacado: true } },
                _count: { select: { resenas: true } }
            }
        });
        res.json(sucursales);
    }
    catch (error) {
        console.error('Error listando lugares turísticos:', error);
        res.status(500).json({ error: 'Error al listar lugares turísticos' });
    }
};
// GET /api/empresas/:empresaId/sucursales  (público)
export const listByEmpresa = async (req, res) => {
    try {
        const empresaId = Number(req.params.empresaId);
        const empresa = await prisma.empresas.findFirst({ where: { id: empresaId, activo: true } });
        if (!empresa)
            return res.status(404).json({ error: 'Empresa no encontrada' });
        const sucursales = await prisma.sucursales.findMany({
            where: { empresa_id: empresaId, activo: true },
            orderBy: { fecha_creacion: 'desc' },
            include: { ciudades: true }
        });
        if (req.user) {
            const conGestion = await Promise.all(sucursales.map(async (s) => ({ ...s, puedoGestionar: await canGestionarSucursal(req, s) })));
            return res.json(conGestion);
        }
        res.json(sucursales);
    }
    catch (error) {
        console.error('Error listando sucursales:', error);
        res.status(500).json({ error: 'Error al listar sucursales' });
    }
};
// GET /api/sucursales/mias  (autenticado: dueño/staff ve las suyas; empleado solo las asignadas)
export const listMine = async (req, res) => {
    try {
        const include = {
            empresas: { select: { id: true, nombre: true } },
            ciudades: { select: { nombre: true } }
        };
        if (isStaff(req)) {
            const sucursales = await prisma.sucursales.findMany({
                where: { activo: true },
                orderBy: { nombre: 'asc' },
                include
            });
            return res.json(sucursales);
        }
        const [empresasPropias, empleados] = await Promise.all([
            prisma.empresas.findMany({
                where: { OR: [{ usuario_empresas: { some: { usuario_id: req.user.id } } }, { propietario: req.user.correo }] },
                select: { id: true }
            }),
            prisma.empresa_empleados.findMany({
                where: { usuario_id: req.user.id, activo: true },
                select: { empresa_id: true, empleado_sucursales: { select: { sucursal_id: true } } }
            })
        ]);
        const idsPropias = empresasPropias.map((e) => e.id);
        const idsAsignadas = empleados.flatMap((e) => e.empleado_sucursales.map((s) => s.sucursal_id));
        const sucursales = await prisma.sucursales.findMany({
            where: {
                activo: true,
                OR: [{ empresa_id: { in: idsPropias } }, { id: { in: idsAsignadas } }]
            },
            orderBy: { nombre: 'asc' },
            include
        });
        res.json(sucursales);
    }
    catch (error) {
        console.error('Error listando mis sucursales:', error);
        res.status(500).json({ error: 'Error al listar mis sucursales' });
    }
};
// GET /api/sucursales/:id  (público; si hay sesión, indica si el usuario puede gestionarla)
export const getById = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const sucursal = await prisma.sucursales.findFirst({
            where: { id, activo: true },
            include: {
                empresas: { include: { categorias_negocio: true } },
                ciudades: true,
                sucursal_servicios: { include: { servicios: true } }
            }
        });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        const resultado = { ...sucursal };
        if (req.user) {
            resultado.puedoGestionar = await canGestionarSucursal(req, sucursal);
        }
        res.json(resultado);
    }
    catch (error) {
        console.error('Error obteniendo sucursal:', error);
        res.status(500).json({ error: 'Error al obtener sucursal' });
    }
};
// POST /api/empresas/:empresaId/sucursales  (requiere permiso sucursales:crear + gestión de la empresa)
export const create = async (req, res) => {
    try {
        const empresaId = Number(req.params.empresaId);
        const empresa = await prisma.empresas.findUnique({ where: { id: empresaId } });
        if (!empresa)
            return res.status(404).json({ error: 'Empresa no encontrada' });
        if (!(await canGestionarEmpresa(req, empresaId))) {
            return res.status(403).json({ error: 'No puedes gestionar esta empresa' });
        }
        // Límite del plan: cantidad de sucursales según la suscripción activa de la empresa
        if (!isStaff(req)) {
            const limite = await limiteSucursales(empresaId);
            if (limite !== null) {
                const count = await prisma.sucursales.count({ where: { empresa_id: empresaId, activo: true } });
                if (count >= limite) {
                    const sub = await suscripcionActiva(empresaId);
                    const plan = sub?.planes?.nombre ?? 'Gratis';
                    return res.status(403).json({
                        error: `Tu plan ${plan} permite hasta ${limite} sucursal(es). Mejora de plan para agregar más.`
                    });
                }
            }
        }
        const { ciudad_id, nombre, direccion, telefono, whatsapp, imagen_principal, latitud, longitud, horario, precio_ninos, precio_adultos, aforo_maximo, gratuito } = req.body;
        if (!ciudad_id || !nombre || !direccion) {
            return res.status(400).json({ error: 'ciudad_id, nombre y direccion son requeridos' });
        }
        const sucursal = await prisma.sucursales.create({
            data: {
                empresa_id: empresaId,
                ciudad_id: Number(ciudad_id),
                nombre,
                direccion,
                telefono,
                whatsapp,
                imagen_principal,
                latitud: latitud !== undefined ? Number(latitud) : undefined,
                longitud: longitud !== undefined ? Number(longitud) : undefined,
                horario,
                precio_ninos: precio_ninos !== undefined && precio_ninos !== '' ? Number(precio_ninos) : undefined,
                precio_adultos: precio_adultos !== undefined && precio_adultos !== '' ? Number(precio_adultos) : undefined,
                aforo_maximo: aforo_maximo !== undefined && aforo_maximo !== '' ? Number(aforo_maximo) : undefined,
                gratuito: gratuito !== undefined ? Boolean(gratuito) : undefined
            }
        });
        res.status(201).json(sucursal);
    }
    catch (error) {
        console.error('Error creando sucursal:', error);
        res.status(500).json({ error: 'Error al crear sucursal' });
    }
};
// PATCH /api/sucursales/:id  (requiere permiso sucursales:editar o empleado asignado a la sucursal)
export const update = async (req, res) => {
    try {
        const sucursal = req.sucursal ?? (await prisma.sucursales.findUnique({ where: { id: Number(req.params.id) } }));
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await canGestionarSucursal(req, sucursal))) {
            return res.status(403).json({ error: 'No puedes gestionar esta sucursal' });
        }
        const campos = ['nombre', 'direccion', 'telefono', 'whatsapp', 'imagen_principal', 'horario', 'ciudad_id'];
        const data = {};
        for (const campo of campos) {
            if (req.body[campo] !== undefined) {
                data[campo] = campo === 'ciudad_id' ? Number(req.body[campo]) : req.body[campo];
            }
        }
        if (req.body.latitud !== undefined)
            data.latitud = Number(req.body.latitud);
        if (req.body.longitud !== undefined)
            data.longitud = Number(req.body.longitud);
        if (req.body.precio_ninos !== undefined)
            data.precio_ninos = req.body.precio_ninos === '' ? null : Number(req.body.precio_ninos);
        if (req.body.precio_adultos !== undefined)
            data.precio_adultos = req.body.precio_adultos === '' ? null : Number(req.body.precio_adultos);
        if (req.body.aforo_maximo !== undefined)
            data.aforo_maximo = req.body.aforo_maximo === '' ? null : Number(req.body.aforo_maximo);
        if (req.body.gratuito !== undefined)
            data.gratuito = Boolean(req.body.gratuito);
        const updated = await prisma.sucursales.update({ where: { id: sucursal.id }, data });
        res.json(updated);
    }
    catch (error) {
        console.error('Error actualizando sucursal:', error);
        res.status(500).json({ error: 'Error al actualizar sucursal' });
    }
};
// PUT /api/sucursales/:id/servicios  (asigna los servicios que ofrece la sucursal, ej. wifi)
export const setServicios = async (req, res) => {
    try {
        const sucursal = req.sucursal ?? (await prisma.sucursales.findUnique({ where: { id: Number(req.params.id) } }));
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await canGestionarSucursal(req, sucursal))) {
            return res.status(403).json({ error: 'No puedes gestionar esta sucursal' });
        }
        const { servicio_ids } = req.body ?? {};
        const ids = Array.isArray(servicio_ids) ? [...new Set(servicio_ids.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))] : [];
        if (ids.length > 0) {
            const validos = await prisma.servicios.count({ where: { id: { in: ids }, activo: true } });
            if (validos !== ids.length) {
                return res.status(400).json({ error: 'Algunos servicios no existen o están inactivos' });
            }
        }
        await prisma.$transaction([
            prisma.sucursal_servicios.deleteMany({ where: { sucursal_id: sucursal.id } }),
            prisma.sucursal_servicios.createMany({ data: ids.map((servicio_id) => ({ sucursal_id: sucursal.id, servicio_id })) })
        ]);
        res.json({ message: 'Servicios actualizados' });
    }
    catch (error) {
        console.error('Error asignando servicios:', error);
        res.status(500).json({ error: 'Error al asignar servicios' });
    }
};
// DELETE /api/sucursales/:id  (requiere permiso sucursales:eliminar; los empleados no eliminan sucursales)
export const remove = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const sucursal = await prisma.sucursales.findUnique({ where: { id } });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        if (!(await canGestionarEmpresa(req, sucursal.empresa_id))) {
            return res.status(403).json({ error: 'No puedes gestionar esta empresa' });
        }
        await prisma.sucursales.update({ where: { id }, data: { activo: false } });
        res.json({ message: 'Sucursal eliminada' });
    }
    catch (error) {
        console.error('Error eliminando sucursal:', error);
        res.status(500).json({ error: 'Error al eliminar sucursal' });
    }
};
