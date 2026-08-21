import { prisma } from '../services/prisma.js';
import { canGestionarEmpleados } from '../middlewares/auth.js';
const usuarioSelect = {
    id: true,
    cedula: true,
    nombres: true,
    apellidos: true,
    correo: true,
    telefono: true,
    foto: true,
    activo: true
};
// GET /api/empresas/:id/empleados  (requiere permiso empresas:ver + gestión)
export const list = async (req, res) => {
    try {
        const empresaId = Number(req.params.id);
        const empresa = await prisma.empresas.findUnique({ where: { id: empresaId } });
        if (!empresa)
            return res.status(404).json({ error: 'Empresa no encontrada' });
        if (!(await canGestionarEmpleados(req, empresaId))) {
            return res.status(403).json({ error: 'No puedes gestionar empleados de esta empresa' });
        }
        const empleados = await prisma.empresa_empleados.findMany({
            where: { empresa_id: empresaId },
            orderBy: { fecha_ingreso: 'desc' },
            include: {
                usuarios: { select: usuarioSelect },
                cargos_empresa: true,
                empleado_permisos: { include: { permisos_empresa: true } },
                empleado_sucursales: { include: { sucursales: { select: { id: true, nombre: true } } } }
            }
        });
        res.json(empleados);
    }
    catch (error) {
        console.error('Error listando empleados:', error);
        res.status(500).json({ error: 'Error al listar empleados' });
    }
};
// GET /api/empresas/:id/empleados/buscar?cedula=&correo=  (buscar persona para contratar)
export const buscar = async (req, res) => {
    try {
        const empresaId = Number(req.params.id);
        const empresa = await prisma.empresas.findUnique({ where: { id: empresaId } });
        if (!empresa)
            return res.status(404).json({ error: 'Empresa no encontrada' });
        if (!(await canGestionarEmpleados(req, empresaId))) {
            return res.status(403).json({ error: 'No puedes gestionar empleados de esta empresa' });
        }
        const cedula = typeof req.query.cedula === 'string' ? req.query.cedula.trim() : '';
        const correo = typeof req.query.correo === 'string' ? req.query.correo.trim() : '';
        if (!cedula && !correo) {
            return res.status(400).json({ error: 'Debe enviar cedula o correo' });
        }
        const usuario = await prisma.usuarios.findFirst({
            where: {
                OR: [{ cedula: cedula || undefined }, { correo: correo || undefined }],
                activo: true
            },
            select: usuarioSelect
        });
        if (!usuario) {
            return res.status(404).json({ error: 'No se encontró ningún usuario con ese dato' });
        }
        const yaEsEmpleado = await prisma.empresa_empleados.findFirst({
            where: { usuario_id: usuario.id, empresa_id: empresaId, activo: true }
        });
        res.json({ usuario, yaEsEmpleado: Boolean(yaEsEmpleado) });
    }
    catch (error) {
        console.error('Error buscando persona:', error);
        res.status(500).json({ error: 'Error al buscar persona' });
    }
};
// POST /api/empresas/:id/empleados  { usuario_id, cargo_id }  (requiere permiso empresas:editar)
export const agregar = async (req, res) => {
    try {
        const empresaId = Number(req.params.id);
        const { usuario_id, cargo_id } = req.body;
        if (!usuario_id || !cargo_id) {
            return res.status(400).json({ error: 'usuario_id y cargo_id son requeridos' });
        }
        const empresa = await prisma.empresas.findUnique({ where: { id: empresaId } });
        if (!empresa)
            return res.status(404).json({ error: 'Empresa no encontrada' });
        if (!(await canGestionarEmpleados(req, empresaId))) {
            return res.status(403).json({ error: 'No puedes gestionar empleados de esta empresa' });
        }
        const usuario = await prisma.usuarios.findUnique({ where: { id: Number(usuario_id) } });
        if (!usuario)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        const cargo = await prisma.cargos_empresa.findUnique({ where: { id: Number(cargo_id) } });
        if (!cargo)
            return res.status(404).json({ error: 'Cargo no encontrado' });
        const existe = await prisma.empresa_empleados.findFirst({
            where: { usuario_id: usuario.id, empresa_id: empresaId, activo: true }
        });
        if (existe)
            return res.status(400).json({ error: 'Este usuario ya es empleado de esta empresa' });
        const empleado = await prisma.$transaction(async (tx) => {
            const creado = await tx.empresa_empleados.create({
                data: { empresa_id: empresaId, usuario_id: usuario.id, cargo_id: Number(cargo_id), activo: true },
                include: { usuarios: { select: usuarioSelect }, cargos_empresa: true }
            });
            // Asegurar rol "empleado_empresa" para darle acceso base a la plataforma
            const rol = await tx.roles.findUnique({ where: { nombre: 'empleado_empresa' } });
            if (rol) {
                const yaTiene = await tx.usuario_roles.findFirst({
                    where: { usuario_id: usuario.id, rol_id: rol.id }
                });
                if (!yaTiene) {
                    await tx.usuario_roles.create({ data: { usuario_id: usuario.id, rol_id: rol.id } });
                }
            }
            return creado;
        });
        res.status(201).json(empleado);
    }
    catch (error) {
        console.error('Error agregando empleado:', error);
        res.status(500).json({ error: 'Error al agregar empleado' });
    }
};
// DELETE /api/empresas/:id/empleados/:empleadoId  (borrado lógico)
export const quitar = async (req, res) => {
    try {
        const empresaId = Number(req.params.id);
        const empleadoId = Number(req.params.empleadoId);
        const empresa = await prisma.empresas.findUnique({ where: { id: empresaId } });
        if (!empresa)
            return res.status(404).json({ error: 'Empresa no encontrada' });
        if (!(await canGestionarEmpleados(req, empresaId))) {
            return res.status(403).json({ error: 'No puedes gestionar empleados de esta empresa' });
        }
        const empleado = await prisma.empresa_empleados.findFirst({
            where: { id: empleadoId, empresa_id: empresaId }
        });
        if (!empleado)
            return res.status(404).json({ error: 'Empleado no encontrado' });
        await prisma.empresa_empleados.update({ where: { id: empleadoId }, data: { activo: false } });
        res.json({ message: 'Empleado retirado de la empresa' });
    }
    catch (error) {
        console.error('Error quitando empleado:', error);
        res.status(500).json({ error: 'Error al quitar empleado' });
    }
};
// GET /api/empresas/:id/empleados/:empleadoId/sucursales  (sucursales de la empresa + cuáles tiene asignadas)
export const listarSucursalesEmpleado = async (req, res) => {
    try {
        const ctx = await verificarEmpleado(req, res);
        if (!ctx)
            return;
        const [sucursales, asignadas] = await Promise.all([
            prisma.sucursales.findMany({
                where: { empresa_id: ctx.empresaId, activo: true },
                orderBy: { nombre: 'asc' },
                select: { id: true, nombre: true, direccion: true, ciudades: { select: { nombre: true } } }
            }),
            prisma.empleado_sucursales.findMany({
                where: { empleado_id: ctx.empleadoId },
                select: { sucursal_id: true }
            })
        ]);
        const set = new Set(asignadas.map((a) => a.sucursal_id));
        res.json(sucursales.map((s) => ({ ...s, asignada: set.has(s.id) })));
    }
    catch (error) {
        console.error('Error listando sucursales del empleado:', error);
        res.status(500).json({ error: 'Error al listar sucursales del empleado' });
    }
};
// PUT /api/empresas/:id/empleados/:empleadoId/sucursales  { sucursal_ids: number[] }
export const asignarSucursalesEmpleado = async (req, res) => {
    try {
        const ctx = await verificarEmpleado(req, res);
        if (!ctx)
            return;
        const { sucursal_ids } = req.body;
        if (!Array.isArray(sucursal_ids)) {
            return res.status(400).json({ error: 'sucursal_ids debe ser un arreglo de ids' });
        }
        const ids = [...new Set(sucursal_ids.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))];
        if (ids.length > 0) {
            const validas = await prisma.sucursales.count({
                where: { id: { in: ids }, empresa_id: ctx.empresaId, activo: true }
            });
            if (validas !== ids.length) {
                return res.status(400).json({ error: 'Alguna sucursal no pertenece a esta empresa' });
            }
        }
        await prisma.$transaction([
            prisma.empleado_sucursales.deleteMany({ where: { empleado_id: ctx.empleadoId } }),
            ...ids.map((sucursal_id) => prisma.empleado_sucursales.create({ data: { empleado_id: ctx.empleadoId, sucursal_id } }))
        ]);
        res.json({ message: 'Sucursales asignadas', sucursal_ids: ids });
    }
    catch (error) {
        console.error('Error asignando sucursales del empleado:', error);
        res.status(500).json({ error: 'Error al asignar sucursales del empleado' });
    }
};
// GET /api/cargos-empresa  (público)
export const listCargos = async (req, res) => {
    try {
        const cargos = await prisma.cargos_empresa.findMany({
            where: { activo: true },
            orderBy: { nombre: 'asc' }
        });
        res.json(cargos);
    }
    catch (error) {
        console.error('Error listando cargos:', error);
        res.status(500).json({ error: 'Error al listar cargos' });
    }
};
const verificarEmpleado = async (req, res) => {
    const empresaId = Number(req.params.id);
    const empleadoId = Number(req.params.empleadoId);
    const empresa = await prisma.empresas.findUnique({ where: { id: empresaId } });
    if (!empresa) {
        res.status(404).json({ error: 'Empresa no encontrada' });
        return null;
    }
    if (!(await canGestionarEmpleados(req, empresaId))) {
        res.status(403).json({ error: 'No puedes gestionar empleados de esta empresa' });
        return null;
    }
    const empleado = await prisma.empresa_empleados.findFirst({
        where: { id: empleadoId, empresa_id: empresaId }
    });
    if (!empleado) {
        res.status(404).json({ error: 'Empleado no encontrado' });
        return null;
    }
    return { empresaId, empleadoId };
};
// GET /api/empresas/:id/empleados/:empleadoId/permisos  (permisos de empresa disponibles + asignados)
export const listarPermisosEmpleado = async (req, res) => {
    try {
        const ctx = await verificarEmpleado(req, res);
        if (!ctx)
            return;
        const [todos, asignados] = await Promise.all([
            prisma.permisos_empresa.findMany({ orderBy: { nombre: 'asc' } }),
            prisma.empleado_permisos.findMany({ where: { empleado_id: ctx.empleadoId }, select: { permiso_id: true } })
        ]);
        const set = new Set(asignados.map((a) => a.permiso_id));
        res.json(todos.map((p) => ({ ...p, asignado: set.has(p.id) })));
    }
    catch (error) {
        console.error('Error listando permisos del empleado:', error);
        res.status(500).json({ error: 'Error al listar permisos del empleado' });
    }
};
// PUT /api/empresas/:id/empleados/:empleadoId/permisos  { permiso_ids: number[] }
export const asignarPermisosEmpleado = async (req, res) => {
    try {
        const ctx = await verificarEmpleado(req, res);
        if (!ctx)
            return;
        const { permiso_ids } = req.body;
        if (!Array.isArray(permiso_ids)) {
            return res.status(400).json({ error: 'permiso_ids debe ser un arreglo de ids' });
        }
        await prisma.$transaction([
            prisma.empleado_permisos.deleteMany({ where: { empleado_id: ctx.empleadoId } }),
            ...permiso_ids.map((pid) => prisma.empleado_permisos.create({
                data: { empleado_id: ctx.empleadoId, permiso_id: Number(pid) }
            }))
        ]);
        res.json({ message: 'Permisos actualizados', permisos: permiso_ids });
    }
    catch (error) {
        console.error('Error asignando permisos del empleado:', error);
        res.status(500).json({ error: 'Error al asignar permisos del empleado' });
    }
};
