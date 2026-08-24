import { prisma } from '../services/prisma.js';
// GET /api/mis-favoritos  (cliente autenticado)
export const listarMios = async (req, res) => {
    try {
        const favoritos = await prisma.favoritos.findMany({
            where: { usuario_id: req.user.id },
            orderBy: { fecha_creacion: 'desc' },
            include: {
                sucursales: {
                    include: {
                        ciudades: { select: { id: true, nombre: true } },
                        empresas: { select: { id: true, nombre: true } }
                    }
                }
            }
        });
        res.json(favoritos);
    }
    catch (error) {
        console.error('Error listando favoritos:', error);
        res.status(500).json({ error: 'Error al listar favoritos' });
    }
};
// GET /api/sucursales/:id/favorito  (cliente autenticado) -> { es_favorito }
export const estado = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const fav = await prisma.favoritos.findFirst({
            where: { sucursal_id: sucursalId, usuario_id: req.user.id }
        });
        res.json({ es_favorito: Boolean(fav) });
    }
    catch (error) {
        console.error('Error consultando favorito:', error);
        res.status(500).json({ error: 'Error al consultar favorito' });
    }
};
// POST /api/sucursales/:id/favorito  (cliente autenticado)
export const agregar = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, activo: true } });
        if (!sucursal)
            return res.status(404).json({ error: 'Sucursal no encontrada' });
        const existente = await prisma.favoritos.findFirst({
            where: { sucursal_id: sucursalId, usuario_id: req.user.id }
        });
        if (!existente) {
            await prisma.favoritos.create({ data: { sucursal_id: sucursalId, usuario_id: req.user.id } });
        }
        res.json({ es_favorito: true });
    }
    catch (error) {
        console.error('Error agregando favorito:', error);
        res.status(500).json({ error: 'Error al agregar favorito' });
    }
};
// DELETE /api/sucursales/:id/favorito  (cliente autenticado)
export const quitar = async (req, res) => {
    try {
        const sucursalId = Number(req.params.id);
        await prisma.favoritos.deleteMany({
            where: { sucursal_id: sucursalId, usuario_id: req.user.id }
        });
        res.json({ es_favorito: false });
    }
    catch (error) {
        console.error('Error quitando favorito:', error);
        res.status(500).json({ error: 'Error al quitar favorito' });
    }
};
