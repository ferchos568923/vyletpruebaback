import { prisma } from '../services/prisma.js';
const includePublicidad = {
    empresas: { select: { id: true, nombre: true, logo: true } }
};
const parseFecha = (v) => (v === undefined || v === null || v === '' ? undefined : new Date(String(v)));
const parseDecimal = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const buildData = (body) => {
    const data = {};
    const campos = ['titulo', 'imagen', 'enlace', 'descripcion', 'ubicacion', 'estado'];
    for (const c of campos)
        if (body[c] !== undefined)
            data[c] = body[c];
    if (body.empresa_id !== undefined)
        data.empresa_id = Number(body.empresa_id);
    if (body.fecha_inicio !== undefined)
        data.fecha_inicio = body.fecha_inicio === '' || body.fecha_inicio === null ? null : parseFecha(body.fecha_inicio);
    if (body.fecha_fin !== undefined)
        data.fecha_fin = body.fecha_fin === '' || body.fecha_fin === null ? null : parseFecha(body.fecha_fin);
    if (body.presupuesto !== undefined)
        data.presupuesto = body.presupuesto === '' || body.presupuesto === null ? null : parseDecimal(body.presupuesto);
    if (body.activo !== undefined)
        data.activo = typeof body.activo === 'boolean' ? body.activo : body.activo === '1' || body.activo === 'true';
    return data;
};
// GET /api/publicidad  (público: solo activas)
export const listPublic = async (req, res) => {
    try {
        const hoy = new Date();
        const publicidades = await prisma.publicidades.findMany({
            where: {
                activo: true,
                estado: 'activa',
                OR: [{ fecha_inicio: null }, { fecha_inicio: { lte: hoy } }],
                AND: [{ OR: [{ fecha_fin: null }, { fecha_fin: { gte: hoy } }] }]
            },
            orderBy: { fecha_creacion: 'desc' },
            include: includePublicidad
        });
        res.json(publicidades);
    }
    catch (error) {
        console.error('Error listando publicidad:', error);
        res.status(500).json({ error: 'Error al listar publicidad' });
    }
};
// GET /api/admin/publicidad  (staff Vylet: todas)
export const adminList = async (req, res) => {
    try {
        const publicidades = await prisma.publicidades.findMany({
            orderBy: { fecha_creacion: 'desc' },
            include: includePublicidad
        });
        res.json(publicidades);
    }
    catch (error) {
        console.error('Error listando publicidad (admin):', error);
        res.status(500).json({ error: 'Error al listar publicidad' });
    }
};
// POST /api/admin/publicidad
export const adminCreate = async (req, res) => {
    try {
        const data = buildData(req.body);
        if (!data.titulo)
            return res.status(400).json({ error: 'titulo es requerido' });
        if (!data.empresa_id)
            return res.status(400).json({ error: 'empresa_id es requerido' });
        const empresa = await prisma.empresas.findUnique({ where: { id: data.empresa_id } });
        if (!empresa)
            return res.status(404).json({ error: 'Empresa no encontrada' });
        data.estado = data.estado ?? 'activa';
        const publicidad = await prisma.publicidades.create({ data, include: includePublicidad });
        res.status(201).json(publicidad);
    }
    catch (error) {
        console.error('Error creando publicidad:', error);
        res.status(500).json({ error: 'Error al crear publicidad' });
    }
};
// PATCH /api/admin/publicidad/:publicidadId
export const adminUpdate = async (req, res) => {
    try {
        const publicidadId = Number(req.params.publicidadId);
        const publicidad = await prisma.publicidades.findUnique({ where: { id: publicidadId } });
        if (!publicidad)
            return res.status(404).json({ error: 'Publicidad no encontrada' });
        const data = buildData(req.body);
        if (data.empresa_id) {
            const empresa = await prisma.empresas.findUnique({ where: { id: data.empresa_id } });
            if (!empresa)
                return res.status(404).json({ error: 'Empresa no encontrada' });
        }
        const actualizado = await prisma.publicidades.update({
            where: { id: publicidadId },
            data,
            include: includePublicidad
        });
        res.json(actualizado);
    }
    catch (error) {
        console.error('Error actualizando publicidad:', error);
        res.status(500).json({ error: 'Error al actualizar publicidad' });
    }
};
// DELETE /api/admin/publicidad/:publicidadId  (soft)
export const adminRemove = async (req, res) => {
    try {
        const publicidadId = Number(req.params.publicidadId);
        const publicidad = await prisma.publicidades.findUnique({ where: { id: publicidadId } });
        if (!publicidad)
            return res.status(404).json({ error: 'Publicidad no encontrada' });
        await prisma.publicidades.update({ where: { id: publicidadId }, data: { activo: false } });
        res.json({ message: 'Publicidad desactivada' });
    }
    catch (error) {
        console.error('Error eliminando publicidad:', error);
        res.status(500).json({ error: 'Error al eliminar publicidad' });
    }
};
