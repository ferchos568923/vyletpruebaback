import bcrypt from 'bcryptjs';
import { prisma } from '../services/prisma.js';
import { hasPermiso } from '../middlewares/auth.js';
const userInclude = {
    roles: true,
    usuario_roles: { include: { roles: true } }
};
// GET /api/usuarios  (requiere permiso usuarios:listar)
export const list = async (req, res) => {
    try {
        const { q, rol_id, rol, activo, pagina = '1', limite = '20' } = req.query;
        const where = {};
        if (q) {
            where.OR = [
                { nombres: { contains: String(q), mode: 'insensitive' } },
                { apellidos: { contains: String(q), mode: 'insensitive' } },
                { correo: { contains: String(q), mode: 'insensitive' } },
                { cedula: { contains: String(q), mode: 'insensitive' } }
            ];
        }
        if (rol_id)
            where.rol_id = Number(rol_id);
        if (rol) {
            const rolEncontrado = await prisma.roles.findFirst({ where: { nombre: String(rol) } });
            if (rolEncontrado) {
                where.AND = [
                    { OR: [{ rol_id: rolEncontrado.id }, { usuario_roles: { some: { rol_id: rolEncontrado.id } } }] }
                ];
            }
        }
        if (activo !== undefined)
            where.activo = activo === '1' || activo === 'true';
        const page = Math.max(1, Number(pagina) || 1);
        const limit = Math.min(100, Math.max(1, Number(limite) || 20));
        const skip = (page - 1) * limit;
        const [total, usuarios] = await Promise.all([
            prisma.usuarios.count({ where }),
            prisma.usuarios.findMany({
                where,
                include: userInclude,
                orderBy: { fecha_creacion: 'desc' },
                skip,
                take: limit
            })
        ]);
        res.json({
            total,
            pagina: page,
            limite: limit,
            usuarios: usuarios.map(({ clave: _clave, ...rest }) => rest)
        });
    }
    catch (error) {
        console.error('Error listando usuarios:', error);
        res.status(500).json({ error: 'Error al listar usuarios' });
    }
};
// GET /api/usuarios/:id  (requiere permiso usuarios:ver)
export const getById = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const user = await prisma.usuarios.findUnique({
            where: { id },
            include: userInclude
        });
        if (!user)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        const { clave: _clave, ...rest } = user;
        res.json(rest);
    }
    catch (error) {
        console.error('Error obteniendo usuario:', error);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
};
// POST /api/usuarios  (requiere permiso usuarios:crear)
export const create = async (req, res) => {
    try {
        const { nombres, apellidos, correo, telefono, clave, genero, fecha_nacimiento, rol_id, roles, cedula } = req.body;
        if (!nombres || !correo || !clave) {
            return res.status(400).json({ error: 'nombres, correo y clave son requeridos' });
        }
        const existing = await prisma.usuarios.findUnique({ where: { correo } });
        if (existing)
            return res.status(400).json({ error: 'El correo ya está registrado' });
        if (cedula) {
            const conCedula = await prisma.usuarios.findUnique({ where: { cedula } });
            if (conCedula)
                return res.status(400).json({ error: 'La cédula ya está registrada' });
        }
        const hashedPassword = await bcrypt.hash(clave, 10);
        let rolPrincipal = rol_id !== undefined ? Number(rol_id) : null;
        const rolesArr = Array.isArray(roles) ? roles.map(Number).filter((n) => Number.isInteger(n)) : [];
        if (!rolPrincipal && rolesArr.length > 0)
            rolPrincipal = rolesArr[0];
        if (!rolPrincipal) {
            const cliente = await prisma.roles.findFirst({ where: { nombre: 'cliente' } });
            rolPrincipal = cliente?.id ?? null;
        }
        const user = await prisma.usuarios.create({
            data: {
                cedula: cedula || null,
                nombres,
                apellidos,
                correo,
                telefono,
                clave: hashedPassword,
                genero,
                fecha_nacimiento: fecha_nacimiento ? new Date(fecha_nacimiento) : null,
                activo: true,
                correo_verificado: false,
                rol_id: rolPrincipal
            },
            include: { roles: true }
        });
        const finalRoles = new Set();
        if (rolPrincipal)
            finalRoles.add(rolPrincipal);
        rolesArr.forEach((r) => finalRoles.add(r));
        if (finalRoles.size > 0) {
            await prisma.usuario_roles.createMany({
                data: [...finalRoles].map((rolId) => ({ usuario_id: user.id, rol_id: rolId }))
            });
        }
        const { clave: _clave, ...rest } = user;
        res.status(201).json(rest);
    }
    catch (error) {
        console.error('Error creando usuario:', error);
        res.status(500).json({ error: 'Error al crear usuario' });
    }
};
// PATCH /api/usuarios/:id  (requiere permiso usuarios:editar)
export const update = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const user = await prisma.usuarios.findUnique({ where: { id } });
        if (!user)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        const data = {};
        const campos = ['nombres', 'apellidos', 'telefono', 'genero', 'foto'];
        for (const campo of campos) {
            if (req.body[campo] !== undefined)
                data[campo] = req.body[campo];
        }
        if (req.body.cedula !== undefined) {
            if (req.body.cedula !== user.cedula) {
                const conCedula = await prisma.usuarios.findUnique({ where: { cedula: req.body.cedula } });
                if (conCedula)
                    return res.status(400).json({ error: 'La cédula ya está registrada' });
            }
            data.cedula = req.body.cedula || null;
        }
        if (req.body.correo !== undefined) {
            if (req.body.correo !== user.correo) {
                const dup = await prisma.usuarios.findUnique({ where: { correo: req.body.correo } });
                if (dup)
                    return res.status(400).json({ error: 'El correo ya está registrado' });
            }
            data.correo = req.body.correo;
        }
        if (req.body.fecha_nacimiento !== undefined) {
            data.fecha_nacimiento = req.body.fecha_nacimiento ? new Date(req.body.fecha_nacimiento) : null;
        }
        if (req.body.clave)
            data.clave = await bcrypt.hash(req.body.clave, 10);
        if (req.body.rol_id !== undefined && hasPermiso(req, 'roles:asignar')) {
            data.rol_id = Number(req.body.rol_id);
        }
        const updated = await prisma.usuarios.update({
            where: { id },
            data,
            include: { roles: true }
        });
        const { clave: _clave, ...rest } = updated;
        res.json(rest);
    }
    catch (error) {
        console.error('Error actualizando usuario:', error);
        res.status(500).json({ error: 'Error al actualizar usuario' });
    }
};
// PATCH /api/usuarios/:id/bloquear  (requiere permiso usuarios:bloquear)
export const toggleActivo = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const user = await prisma.usuarios.findUnique({ where: { id } });
        if (!user)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        if (id === req.user.id)
            return res.status(400).json({ error: 'No puedes bloquear tu propia cuenta' });
        const activo = req.body.activo !== undefined ? Boolean(req.body.activo) : !user.activo;
        const updated = await prisma.usuarios.update({ where: { id }, data: { activo } });
        const { clave: _clave, ...rest } = updated;
        res.json(rest);
    }
    catch (error) {
        console.error('Error bloqueando usuario:', error);
        res.status(500).json({ error: 'Error al bloquear usuario' });
    }
};
// PATCH /api/usuarios/:id/roles  (requiere permiso roles:asignar)
export const assignRoles = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const user = await prisma.usuarios.findUnique({ where: { id } });
        if (!user)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        const roles = Array.isArray(req.body.roles)
            ? req.body.roles.map((n) => Number(n)).filter((n) => Number.isInteger(n))
            : [];
        if (roles.length === 0 && req.body.rol_id === undefined) {
            return res.status(400).json({ error: 'Envíe el array de roles o rol_id' });
        }
        const unique = [...new Set(roles)];
        const rolPrincipal = req.body.rol_id !== undefined ? Number(req.body.rol_id) : (unique[0] ?? user.rol_id);
        const ops = [prisma.usuario_roles.deleteMany({ where: { usuario_id: id } })];
        if (unique.length > 0) {
            ops.push(prisma.usuario_roles.createMany({ data: unique.map((rol_id) => ({ usuario_id: id, rol_id })) }));
        }
        ops.push(prisma.usuarios.update({ where: { id }, data: { rol_id: rolPrincipal } }));
        await prisma.$transaction(ops);
        const updated = await prisma.usuarios.findUnique({ where: { id }, include: userInclude });
        const { clave: _clave, ...rest } = updated;
        res.json(rest);
    }
    catch (error) {
        console.error('Error asignando roles:', error);
        res.status(500).json({ error: 'Error al asignar roles' });
    }
};
// POST /api/usuarios/:id/hacer-dueno  (requiere permiso usuarios:editar)
export const hacerDueno = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const usuario = await prisma.usuarios.findUnique({ where: { id } });
        if (!usuario)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        let rolDueno = await prisma.roles.findFirst({ where: { nombre: 'dueno_empresa' } });
        if (!rolDueno) {
            rolDueno = await prisma.roles.create({ data: { nombre: 'dueno_empresa', activo: true } });
        }
        const yaTieneRol = await prisma.usuario_roles.findFirst({ where: { usuario_id: id, rol_id: rolDueno.id } });
        const ops = [prisma.usuarios.update({ where: { id }, data: { rol_id: rolDueno.id } })];
        if (!yaTieneRol) {
            ops.push(prisma.usuario_roles.create({ data: { usuario_id: id, rol_id: rolDueno.id } }));
        }
        await prisma.$transaction(ops);
        res.json({ message: `${usuario.nombres} ${usuario.apellidos ?? ''} ahora es dueño de negocio.` });
    }
    catch (error) {
        console.error('Error asignando rol dueño:', error);
        res.status(500).json({ error: 'Error al asignar rol dueño' });
    }
};
// DELETE /api/usuarios/:id  (requiere permiso usuarios:eliminar + borrado lógico)
export const remove = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const user = await prisma.usuarios.findUnique({ where: { id } });
        if (!user)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        if (id === req.user.id)
            return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
        await prisma.usuarios.update({ where: { id }, data: { activo: false } });
        res.json({ message: 'Usuario eliminado' });
    }
    catch (error) {
        console.error('Error eliminando usuario:', error);
        res.status(500).json({ error: 'Error al eliminar usuario' });
    }
};
