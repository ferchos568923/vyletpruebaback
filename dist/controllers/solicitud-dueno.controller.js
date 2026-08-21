import { prisma } from '../services/prisma.js';
// GET /api/solicitud-dueno/mi  (autenticado: estado de la solicitud del usuario)
export const miEstado = async (req, res) => {
    try {
        const solicitud = await prisma.solicitudes_dueno.findFirst({
            where: { usuario_id: req.user.id },
            orderBy: { fecha_creacion: 'desc' }
        });
        res.json({ estado: solicitud?.estado ?? 'ninguna', solicitud });
    }
    catch (error) {
        console.error('Error obteniendo mi solicitud:', error);
        res.status(500).json({ error: 'Error al obtener la solicitud' });
    }
};
// GET /api/admin/solicitudes-dueno  (requiere usuarios:editar)
export const list = async (req, res) => {
    try {
        const { estado } = req.query;
        const where = {};
        if (estado)
            where.estado = String(estado);
        const solicitudes = await prisma.solicitudes_dueno.findMany({
            where,
            orderBy: [{ estado: 'asc' }, { fecha_creacion: 'desc' }],
            include: {
                usuarios: {
                    select: { id: true, nombres: true, apellidos: true, correo: true, telefono: true, fecha_creacion: true }
                }
            }
        });
        res.json(solicitudes);
    }
    catch (error) {
        console.error('Error listando solicitudes de dueño:', error);
        res.status(500).json({ error: 'Error al listar solicitudes' });
    }
};
// POST /api/admin/solicitudes-dueno/:id/aprobar
export const aprobar = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const solicitud = await prisma.solicitudes_dueno.findUnique({ where: { id } });
        if (!solicitud)
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        if (solicitud.estado !== 'pendiente') {
            return res.status(400).json({ error: `La solicitud ya fue ${solicitud.estado}` });
        }
        let rolDueno = await prisma.roles.findFirst({ where: { nombre: 'dueno_empresa' } });
        if (!rolDueno) {
            rolDueno = await prisma.roles.create({ data: { nombre: 'dueno_empresa', activo: true } });
        }
        const yaTieneRol = await prisma.usuario_roles.findFirst({
            where: { usuario_id: solicitud.usuario_id, rol_id: rolDueno.id }
        });
        const ops = [
            prisma.usuarios.update({ where: { id: solicitud.usuario_id }, data: { rol_id: rolDueno.id } }),
            prisma.solicitudes_dueno.update({
                where: { id },
                data: { estado: 'aprobada', fecha_respuesta: new Date(), atendido_por: req.user.id }
            })
        ];
        if (!yaTieneRol) {
            ops.push(prisma.usuario_roles.create({ data: { usuario_id: solicitud.usuario_id, rol_id: rolDueno.id } }));
        }
        await prisma.$transaction(ops);
        res.json({ message: 'Solicitud aprobada. El usuario ahora es dueño de negocio.' });
    }
    catch (error) {
        console.error('Error aprobando solicitud:', error);
        res.status(500).json({ error: 'Error al aprobar la solicitud' });
    }
};
// POST /api/admin/solicitudes-dueno/:id/rechazar
export const rechazar = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const solicitud = await prisma.solicitudes_dueno.findUnique({ where: { id } });
        if (!solicitud)
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        if (solicitud.estado !== 'pendiente') {
            return res.status(400).json({ error: `La solicitud ya fue ${solicitud.estado}` });
        }
        await prisma.solicitudes_dueno.update({
            where: { id },
            data: { estado: 'rechazada', fecha_respuesta: new Date(), atendido_por: req.user.id }
        });
        res.json({ message: 'Solicitud rechazada. El usuario permanece como cliente.' });
    }
    catch (error) {
        console.error('Error rechazando solicitud:', error);
        res.status(500).json({ error: 'Error al rechazar la solicitud' });
    }
};
