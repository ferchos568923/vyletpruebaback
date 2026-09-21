import { prisma } from '../services/prisma.js';
// POST /api/compartir-contenido  { usuario_id, titulo, mensaje, enlace }
export const compartirContenido = async (req, res) => {
    try {
        const usuarioId = Number(req.body?.usuario_id);
        const titulo = String(req.body?.titulo ?? '');
        const mensaje = String(req.body?.mensaje ?? '');
        const enlaceRaw = String(req.body?.enlace ?? '');
        let enlace = enlaceRaw;
        try {
            if (enlaceRaw.startsWith('http')) {
                const url = new URL(enlaceRaw);
                enlace = url.pathname;
            }
        }
        catch { }
        if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
            return res.status(400).json({ error: 'usuario_id es requerido' });
        }
        if (usuarioId === req.user.id) {
            return res.status(400).json({ error: 'No puedes enviar contenido a ti mismo' });
        }
        const destino = await prisma.usuarios.findFirst({ where: { id: usuarioId, activo: true } });
        if (!destino)
            return res.status(404).json({ error: 'Usuario no encontrado' });
        await prisma.notificaciones.create({
            data: {
                usuario_id: usuarioId,
                tipo: 'compartir',
                titulo: `${req.user.nombres} te compartió: ${titulo}`,
                mensaje: mensaje || enlace,
                enlace: enlace || null,
            }
        });
        res.status(201).json({ message: 'Contenido compartido exitosamente' });
    }
    catch (error) {
        console.error('Error compartiendo contenido:', error);
        res.status(500).json({ error: 'Error al compartir contenido' });
    }
};
